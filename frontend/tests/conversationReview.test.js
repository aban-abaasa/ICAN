import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBusinessReview, buildResumeReview, businessPayload, resumePayload,
} from '../src/utils/conversationReview.js';

const resumeResult = {
  headline: 'Stock controller', summary: 'Careful and fast.', skills: ['Excel', 'Stock control'], location: 'Kampala',
  phone: '', contactEmail: '',
  links: [{ label: 'LinkedIn', url: 'https://linkedin.com/in/a' }],
  items: [
    { itemType: 'experience', title: 'Stock controller', orgName: 'Nile Breweries', description: 'Cut wastage 12%', startDate: '2019-01-01', endDate: '' },
    { itemType: 'education', title: 'BSc Accounting', orgName: 'Makerere', description: '', startDate: '2014-01-01', endDate: '2018-01-01' },
  ],
};

test('resume review leaves out what is already there and never ticks a replacement', () => {
  const rows = buildResumeReview(resumeResult, {
    form: { headline: 'Old headline', summary: '', skills: 'excel, Welding', location: 'Kampala', phone: '', contactEmail: '' },
    links: [{ label: 'x', url: 'HTTPS://linkedin.com/in/a' }],
    items: [{ title: 'bsc accounting', org_name: 'Makerere' }],
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.headline.checked, false); // replaces text the person wrote
  assert.equal(byId.headline.note, 'Replaces what you have now');
  assert.equal(byId.summary.checked, true);
  assert.equal('location' in byId, false); // identical
  assert.deepEqual(byId.skills.apply, ['Stock control']); // Excel already present
  assert.equal(Object.keys(byId).some((id) => id.startsWith('link-')), false);
  assert.deepEqual(Object.keys(byId).filter((id) => id.startsWith('item-')), ['item-0']); // degree already there
});

test('resumePayload carries only ticked rows', () => {
  const rows = buildResumeReview(resumeResult, { form: { headline: '', summary: '', skills: '', location: '', phone: '', contactEmail: '' }, links: [], items: [] });
  const payload = resumePayload(rows, new Set(['headline', 'skills', 'link-0', 'item-1']));
  assert.deepEqual(payload.fields, { headline: 'Stock controller' });
  assert.deepEqual(payload.skills, ['Excel', 'Stock control']);
  assert.equal(payload.links.length, 1);
  assert.deepEqual(payload.items.map((i) => i.title), ['BSc Accounting']);
});

const countries = [{ code: 'UG', name: 'Uganda' }, { code: 'KE', name: 'Kenya' }];
const businessResult = {
  businessName: 'Masindi Grain Ltd', businessType: 'LLC', businessStructure: 'sole_proprietorship', country: 'uganda',
  website: 'https://masindigrain.example', foundedYear: 2022, businessAddress: '', description: 'We dry maize.',
  plan: { businessPlan: 'Problem: x', financials: '', wants: 'Clean grain', fears: '', needs: '' },
};

test('business review maps the country to its code and protects typed details', () => {
  const year = new Date().getFullYear();
  const rows = buildBusinessReview(businessResult, {
    businessName: '', businessType: '', businessStructure: 'organisation', country: '', website: '', foundedYear: year,
    businessAddress: '', description: 'My own words',
  }, countries);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.country.apply, 'UG');
  assert.equal(byId.country.proposed, 'Uganda');
  assert.equal(byId.businessStructure.checked, false);
  assert.equal(byId.businessStructure.proposed, 'Sole Proprietorship');
  assert.equal(byId.description.checked, false); // would replace typed text
  assert.equal(byId.foundedYear.checked, true); // the form only held the default year
  assert.equal(byId.businessName.checked, true);
  assert.equal('plan-financials' in byId, false); // empty sections are not proposed
  assert.equal(byId['plan-wants'].checked, true);
});

test('business review does not guess an unknown country', () => {
  const rows = buildBusinessReview({ ...businessResult, country: 'Narnia' }, { businessName: '', country: '' }, countries);
  assert.equal(rows.some((r) => r.id === 'country'), false);
});

test('businessPayload splits fields from pitch-document sections', () => {
  const rows = buildBusinessReview(businessResult, { businessName: '', country: '' }, countries);
  const payload = businessPayload(rows, new Set(['businessName', 'country', 'plan-businessPlan']));
  assert.deepEqual(payload.fields, { businessName: 'Masindi Grain Ltd', country: 'UG' });
  assert.deepEqual(payload.plan, { businessPlan: 'Problem: x' });
});
