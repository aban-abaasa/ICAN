// Turns what the AI reader found into a list of proposed changes the person can tick or untick.
// Pure functions: nothing here touches the network or the database.
//
// The builders compare the proposal with what the form already holds, so details that are
// already there are left out, and anything that would replace existing text is shown unticked.

// ---------------------------------------------------------------- review rows
//
// A row is one proposed change: { id, group, label, proposed, current, note, checked, apply }.
// `apply` is the value handed to the host on confirm. Rows for things the form already has
// are left out entirely; rows that would replace something are shown unticked.

const norm = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const row = (id, group, label, proposed, current, { checked, note = '', apply = proposed } = {}) => ({
  id, group, label, proposed, current: current || '', note, checked: checked ?? !String(current || '').trim(), apply,
});

/**
 * @param result  sanitised resume result from the server
 * @param current { form: {headline, summary, skills (comma text), location, phone, contactEmail},
 *                  links: [{label, url}], items: [{ title, org_name }] }
 */
export function buildResumeReview(result, current) {
  const rows = [];
  const scalars = [
    ['headline', 'Headline'], ['summary', 'Professional summary'], ['location', 'Location'],
    ['phone', 'Phone'], ['contactEmail', 'Email'],
  ];
  for (const [key, label] of scalars) {
    const proposed = result[key];
    const existing = current.form?.[key] || '';
    if (!proposed || norm(proposed) === norm(existing)) continue;
    rows.push(row(key, 'Profile details', label, proposed, existing, {
      note: existing.trim() ? 'Replaces what you have now' : '',
    }));
  }

  const haveSkills = new Set(String(current.form?.skills || '').split(',').map(norm).filter(Boolean));
  const newSkills = (result.skills || []).filter((s) => !haveSkills.has(norm(s)));
  if (newSkills.length) {
    rows.push(row('skills', 'Profile details', 'Skills', newSkills.join(', '), '', { checked: true, note: 'Added to your existing skills', apply: newSkills }));
  }

  const haveLinks = new Set((current.links || []).map((l) => norm(l.url)));
  (result.links || []).forEach((link, i) => {
    if (haveLinks.has(norm(link.url))) return;
    rows.push(row(`link-${i}`, 'Links', link.label, link.url, '', { checked: true, apply: link }));
  });

  const haveItems = new Set((current.items || []).map((it) => `${norm(it.title)}|${norm(it.org_name)}`));
  (result.items || []).forEach((item, i) => {
    if (haveItems.has(`${norm(item.title)}|${norm(item.orgName)}`)) return;
    const when = [item.startDate && item.startDate.slice(0, 4), item.endDate ? item.endDate.slice(0, 4) : (item.startDate ? 'Present' : '')].filter(Boolean).join(' – ');
    const label = [item.title, item.orgName].filter(Boolean).join(' · ');
    rows.push(row(`item-${i}`, 'Experience & achievements', label, [when, item.description].filter(Boolean).join('\n'), '', { checked: true, apply: item }));
  });
  return rows;
}

/** Convert ticked review rows into what the resume host applies. */
export function resumePayload(rows, checkedIds) {
  const payload = { fields: {}, skills: [], links: [], items: [] };
  for (const r of rows) {
    if (!checkedIds.has(r.id)) continue;
    if (r.id === 'skills') payload.skills = r.apply;
    else if (r.id.startsWith('link-')) payload.links.push(r.apply);
    else if (r.id.startsWith('item-')) payload.items.push(r.apply);
    else payload.fields[r.id] = r.apply;
  }
  return payload;
}

// The business form stores the country as its ISO code, the model returns a name.
const countryCode = (name, countries) => {
  const wanted = norm(name);
  if (!wanted) return '';
  return countries.find((c) => norm(c.name) === wanted || norm(c.code) === wanted)?.code || '';
};

const STRUCTURE_LABELS = {
  sole_proprietorship: 'Sole Proprietorship', organisation: 'Organisation',
  enterprise: 'Enterprise', limited_by_guarantee: 'Limited by Guarantee',
};

const PLAN_LABELS = {
  businessPlan: 'Business plan', financials: 'Financial projection',
  wants: 'What customers want', fears: 'What customers fear', needs: 'What customers need',
};

/**
 * @param result    sanitised business result from the server
 * @param current   the business form values { businessName, businessType, businessStructure, country,
 *                  website, foundedYear, businessAddress, description }
 * @param countries the app's country list [{ code, name }]
 */
export function buildBusinessReview(result, current, countries = []) {
  const rows = [];
  const defaultYear = new Date().getFullYear();
  const scalar = (key, label, proposed, existing, extra = {}) => {
    if (!proposed || norm(proposed) === norm(existing)) return;
    const replaces = String(existing || '').trim();
    const show = extra.show || ((v) => v);
    rows.push(row(key, 'Business details', label, show(String(proposed)), show(String(existing || '')), {
      note: replaces ? 'Replaces what you have now' : '', apply: proposed, ...extra.row,
    }));
  };
  scalar('businessName', 'Business name', result.businessName, current.businessName);
  scalar('businessType', 'Business type', result.businessType, current.businessType);
  // Structure changes how many owners are required, so it is never ticked for the person.
  scalar('businessStructure', 'Operating structure', result.businessStructure, current.businessStructure, {
    show: (v) => STRUCTURE_LABELS[v] || v,
    row: { checked: false, note: 'Changes how many owners you need, so check it first' },
  });
  const code = countryCode(result.country, countries);
  if (code && code !== current.country) {
    const name = countries.find((c) => c.code === code)?.name || code;
    const existingName = countries.find((c) => c.code === current.country)?.name || '';
    rows.push(row('country', 'Business details', 'Country', name, existingName, { apply: code, note: existingName ? 'Replaces what you have now' : '' }));
  }
  scalar('website', 'Website', result.website, current.website);
  if (result.foundedYear && result.foundedYear !== Number(current.foundedYear)) {
    // The form starts on the current year, which is a default and not something the person typed.
    const isDefault = !current.foundedYear || Number(current.foundedYear) === defaultYear;
    rows.push(row('foundedYear', 'Business details', 'Founded', String(result.foundedYear), isDefault ? '' : String(current.foundedYear), { apply: result.foundedYear, checked: isDefault }));
  }
  scalar('businessAddress', 'Business address', result.businessAddress, current.businessAddress);
  scalar('description', 'Description', result.description, current.description);

  for (const [key, label] of Object.entries(PLAN_LABELS)) {
    const proposed = result.plan?.[key];
    if (!proposed) continue;
    rows.push(row(`plan-${key}`, 'For your pitch documents', label, proposed, '', {
      checked: true, note: 'Fills this section only if it is still empty', apply: proposed,
    }));
  }
  return rows;
}

/** Convert ticked review rows into what the business form applies. */
export function businessPayload(rows, checkedIds) {
  const payload = { fields: {}, plan: {} };
  for (const r of rows) {
    if (!checkedIds.has(r.id)) continue;
    if (r.id.startsWith('plan-')) payload.plan[r.id.slice(5)] = r.apply;
    else payload.fields[r.id] = r.apply;
  }
  return payload;
}
