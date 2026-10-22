\set ON_ERROR_STOP on
-- A rider who goes in by force keeps it on his public record: 20261112100000_zone_forced_entry_record.sql.
-- Runs after 06_card_page.sql on the same data, in a zone of its own ("Gate lab").

-- the public record, as a signed-out visitor of the card page reads it
CREATE FUNCTION t.record(p_rider INT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB; v_prev TEXT := current_user; BEGIN
  EXECUTE 'SET ROLE anon'; r := public.mbg_rider_gate_record(t.code(p_rider)); EXECUTE format('SET ROLE %I', v_prev);
  RETURN r; END $$;
GRANT EXECUTE ON FUNCTION t.record(INT) TO PUBLIC;

SELECT t.login(1);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_upsert(t.u(100), NULL, 'Gate lab', 'estate', 'Plot 3, Kololo', 'active', 'paid_entry', 'per_entry', true, false, 60, 1000, 10,
                              'Africa/Kampala', '{"motorcycle": 2000, "car": 5000, "truck": 0}'::JSONB);
  PERFORM t.check('the gate lab is created', r ->> 'success' = 'true', r::TEXT);
  INSERT INTO t.keep VALUES ('gl', r ->> 'zone_id');
  r := public.mbg_zone_member_add(t.zid('gl'), t.u(1011), 'staff', NULL, NULL, NULL, NULL);
  PERFORM t.check('rider 11 is approved there', r ->> 'success' = 'true');
END $$;

-- ═══ who may report ═════════════════════════════════════════════════════════
SELECT t.login(3, 'viewer@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'forced_entry');
  PERFORM t.check('a view-only role cannot record it', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%cannot run the gate%', r::TEXT);
END $$;
SELECT t.login(4, 'manager@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'forced_entry');
  PERFORM t.check('nor a manager who does not run the gate', r ->> 'success' = 'false', r::TEXT);
END $$;
SELECT t.login(5);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'forced_entry');
  PERFORM t.check('nor a stranger', r ->> 'success' = 'false', r::TEXT);
END $$;
SELECT t.as_anon();
DO $$ BEGIN
  PERFORM t.check('a signed-out visitor cannot report', t.raises('SELECT public.mbg_zone_report_incident(t.zid(''gl''), t.code(15), ''forced_entry'', NULL)'));
  PERFORM t.check('...nor settle or withdraw', t.raises('SELECT public.mbg_zone_incident_resolve(t.u(1), ''settled'', NULL)'));
  PERFORM t.check('...nor read the private lines', t.raises('SELECT public.mbg_zone_rider_incidents(t.code(15))'));
  PERFORM t.check('the table itself is closed to the API', t.raises('SELECT * FROM public.mbg_access_incidents'));
END $$;
SELECT t.login(5);
DO $$ BEGIN PERFORM t.check('...for signed-in people too', t.raises('SELECT * FROM public.mbg_access_incidents')); END $$;

-- ═══ what cannot be reported ════════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'jumped_the_queue');
  PERFORM t.check('an unknown kind of report is refused', r ->> 'success' = 'false', r::TEXT);
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'forced_entry', repeat('x', 301));
  PERFORM t.check('a note over 300 characters is refused', r ->> 'success' = 'false', r::TEXT);
  r := public.mbg_zone_report_incident(t.zid('gl'), 'NOTACARD0000', 'forced_entry');
  PERFORM t.check('nothing is recorded against a code that is not a rider card', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%not a BodaGoEra rider card%', r::TEXT);
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(11), 'forced_entry');
  PERFORM t.check('an approved vehicle was allowed in: it cannot be reported for forcing its way in', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%approved list%', r::TEXT);
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'left_without_clearing');
  PERFORM t.check('a vehicle that never checked in cannot have left without clearing', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%not checked in%', r::TEXT);
  -- an approved vehicle that is inside, a free-entry vehicle that is inside
  r := public.mbg_zone_gate_scan(t.zid('gl'), t.code(13), 'in');
  PERFORM t.check('the truck gets in free', r ->> 'verdict' = 'granted', r::TEXT);
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(13), 'forced_entry');
  PERFORM t.check('a vehicle that is checked in did not force its way in', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%checked in%', r::TEXT);
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(13), 'left_without_clearing');
  PERFORM t.check('and one that owes nothing cannot have left without paying', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%Nothing is owed%', r::TEXT);
  PERFORM public.mbg_zone_gate_scan(t.zid('gl'), t.code(13), 'out');
  PERFORM t.check('nothing was recorded by all that', (t.record(11) ->> 'forced_entries') = '0' AND (t.record(13) ->> 'forced_entries') = '0');
END $$;
SELECT t.login(2, 'guard@x.test');

-- ═══ goes in by force ═══════════════════════════════════════════════════════
DO $$ DECLARE r JSONB; BEGIN
  -- the gate asked rider 15 for the fee, and the rider drove on without paying
  r := public.mbg_zone_gate_scan(t.zid('gl'), t.code(15), 'in');
  PERFORM t.check('the gate asks rider 15 for UGX 2,000', r ->> 'verdict' = 'pay_required', r::TEXT);
  INSERT INTO t.keep VALUES ('gl_v15', t.vid(r)::TEXT);
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'forced_entry', 'Drove round the barrier at 08:10, did not stop');
  PERFORM t.check('the guard records the forced entry', r ->> 'success' = 'true' AND r #>> '{incident,kind}' = 'forced_entry' AND r #>> '{incident,status}' = 'open', r::TEXT);
  PERFORM t.check('...with the fee it avoided, for the business', (r #>> '{incident,owed_ugx}')::NUMERIC = 2000, r::TEXT);
  PERFORM t.check('...and who recorded it, for the business', r #>> '{incident,reported_by}' = 'guard@x.test' AND r #>> '{incident,note}' LIKE 'Drove round%', r::TEXT);
  INSERT INTO t.keep VALUES ('gl_i15', r #>> '{incident,id}');
  PERFORM t.check('the fee request that was waiting is closed, not left to be paid by a vehicle that is already in',
    (public.mbg_zone_visit_status(t.zid('gl_v15')) #>> '{visit,status}') = 'cancelled' AND (public.mbg_zone_visit_status(t.zid('gl_v15')) #>> '{visit,reason}') LIKE 'Went in by force%');
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(15), 'forced_entry');
  PERFORM t.check('the same report again (a double tap, a second guard) is the same line', r ->> 'already_recorded' = 'true' AND r #>> '{incident,id}' = t.zid('gl_i15')::TEXT, r::TEXT);
  -- no request had been made: it simply drove in
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(12), 'forced_entry');
  PERFORM t.check('a car that drove straight in is recorded with the car rate it avoided', r ->> 'success' = 'true' AND (r #>> '{incident,owed_ugx}')::NUMERIC = 5000, r::TEXT);
  INSERT INTO t.keep VALUES ('gl_i12', r #>> '{incident,id}');
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('the rider is told at once, and where to dispute it', EXISTS (SELECT 1 FROM public.push_log WHERE user_id = t.u(15) AND source = 'bodagoera_gate'
                  AND title = 'Recorded at Gate lab' AND message LIKE '%public rider card%' AND message LIKE '%Kololo Heights Estate%'));
  PERFORM t.check('the refused drive-in shows in the zone log too', EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE zone_id = t.zid('gl') AND status = 'denied'
                  AND reason LIKE 'Went in by force%' AND card_number = 'ICN-12'));
END $$;

-- ═══ left without clearing ══════════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; v UUID; BEGIN
  r := public.mbg_zone_gate_scan(t.zid('gl'), t.code(16), 'in');
  v := t.vid(r);
  PERFORM public.mbg_zone_gate_collect_cash(v);
  INSERT INTO t.keep VALUES ('gl_v16', v::TEXT);
END $$;
SELECT t.as_admin();
UPDATE public.mbg_access_visits SET entered_at = now() - INTERVAL '3 hours 10 minutes' WHERE id = t.zid('gl_v16');
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(16), 'left_without_clearing');
  PERFORM t.check('it left owing the overstay: recorded with what is owed', r ->> 'success' = 'true' AND r #>> '{incident,kind}' = 'left_without_clearing'
                  AND (r #>> '{incident,owed_ugx}')::NUMERIC = 3000, r::TEXT);
  PERFORM t.check('the visit is closed with the reason, so it is not inside for ever',
    (public.mbg_zone_visit_status(t.zid('gl_v16')) #>> '{visit,status}') = 'exited' AND (public.mbg_zone_visit_status(t.zid('gl_v16')) #>> '{visit,reason}') LIKE 'Left without clearing: UGX 3,000%');
  r := public.mbg_zone_gate_scan(t.zid('gl'), t.code(16), 'auto');
  PERFORM t.check('...and the vehicle can be checked in again (it pays again)', r ->> 'verdict' = 'pay_required' AND r ->> 'direction' = 'in', r::TEXT);
  PERFORM t.check('...and the gate is warned about the record', EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'warnings') w
                  WHERE w LIKE 'On record for going in by force or leaving without paying: 1 time (1 not settled). Latest: Gate lab%'), r::TEXT);
  PERFORM public.mbg_zone_gate_cancel(t.vid(r));
END $$;

-- ═══ what everybody can read ═══════════════════════════════════════════════
DO $$ DECLARE r JSONB; i JSONB; BEGIN
  r := t.record(15);
  PERFORM t.check('the public record of rider 15: one forced entry, not settled', r ->> 'found' = 'true' AND (r ->> 'forced_entries')::INT = 1
                  AND (r ->> 'left_without_clearing')::INT = 0 AND (r ->> 'open')::INT = 1 AND jsonb_array_length(r -> 'incidents') = 1, r::TEXT);
  i := r #> '{incidents,0}';
  PERFORM t.check('...naming the area, the organisation and the date', i ->> 'zone_name' = 'Gate lab' AND i ->> 'organisation' = 'Kololo Heights Estate'
                  AND i ->> 'kind' = 'forced_entry' AND i ->> 'status' = 'open' AND i ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$', i::TEXT);
  PERFORM t.check('...and never who recorded it, the private note or the amount', NOT (i ? 'note') AND NOT (i ? 'reported_by') AND NOT (i ? 'owed_ugx')
                  AND r::TEXT NOT LIKE '%guard@x.test%' AND r::TEXT NOT LIKE '%Drove round%' AND r::TEXT NOT LIKE '%owed%', r::TEXT);
  r := t.record(16);
  PERFORM t.check('rider 16: left without clearing', (r ->> 'left_without_clearing')::INT = 1 AND (r ->> 'forced_entries')::INT = 0, r::TEXT);
  r := t.record(14);
  PERFORM t.check('a rider with a clean record: found, nothing on it', r ->> 'found' = 'true' AND (r ->> 'forced_entries')::INT = 0 AND jsonb_array_length(r -> 'incidents') = 0, r::TEXT);
  PERFORM t.check('an unknown code is not found', public.mbg_rider_gate_record('NOTACARD0000') ->> 'found' = 'false');
  PERFORM t.check('the whole link works as well as the bare code', (public.mbg_rider_gate_record('https://bodagoera.icanera.space/rider-card/' || t.code(15)) ->> 'forced_entries')::INT = 1);
END $$;

-- ═══ every other gate is warned ═════════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_peek(t.zid('gl'), t.code(15));
  PERFORM t.check('the card page preview warns the gate', EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'warnings') w WHERE w LIKE 'On record for going in by force%'), r::TEXT);
  r := public.mbg_zone_gate_peek(t.zid('gl'), t.code(14));
  PERFORM t.check('...and says nothing about a clean rider', NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'warnings') w WHERE w LIKE 'On record%'), r::TEXT);
  r := public.mbg_zone_gate_peek(t.zid('estate'), t.code(15));
  PERFORM t.check('the record follows the rider to every zone, not just the one it happened at', EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'warnings') w WHERE w LIKE '%Latest: Gate lab%'), r::TEXT);
END $$;

-- ═══ the lines staff may act on ═════════════════════════════════════════════
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_rider_incidents(t.code(15));
  PERFORM t.check('the guard sees the line with its private details and may settle it, not withdraw it', jsonb_array_length(r -> 'incidents') = 1
                  AND r #>> '{incidents,0,note}' LIKE 'Drove round%' AND r #>> '{incidents,0,reported_by}' = 'guard@x.test'
                  AND r #>> '{incidents,0,can_settle}' = 'true' AND r #>> '{incidents,0,can_withdraw}' = 'false', r::TEXT);
END $$;
SELECT t.login(4, 'manager@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_rider_incidents(t.code(15));
  PERFORM t.check('the manager sees it and may withdraw it, not settle it', jsonb_array_length(r -> 'incidents') = 1
                  AND r #>> '{incidents,0,can_withdraw}' = 'true' AND r #>> '{incidents,0,can_settle}' = 'false', r::TEXT);
END $$;
SELECT t.login(5);
DO $$ BEGIN PERFORM t.check('a stranger sees none of it', jsonb_array_length(public.mbg_zone_rider_incidents(t.code(15)) -> 'incidents') = 0); END $$;
SELECT t.login(3, 'viewer@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_rider_incidents(t.code(15));
  PERFORM t.check('a view-only role can read it but act on nothing', jsonb_array_length(r -> 'incidents') = 1 AND r #>> '{incidents,0,can_settle}' = 'false'
                  AND r #>> '{incidents,0,can_withdraw}' = 'false', r::TEXT);
  r := public.mbg_zone_incident_resolve(t.zid('gl_i15'), 'settled');
  PERFORM t.check('...and cannot settle it', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%cannot settle%', r::TEXT);
  r := public.mbg_zone_incident_resolve(t.zid('gl_i15'), 'withdrawn');
  PERFORM t.check('...or withdraw it', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%manager%', r::TEXT);
END $$;
SELECT t.login(5);
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_incident_resolve(t.zid('gl_i15'), 'settled');
  PERFORM t.check('a stranger cannot even tell the record exists', r ->> 'success' = 'false' AND r ->> 'error' = 'Record not found', r::TEXT);
END $$;

-- ═══ settled: it stays on the record ════════════════════════════════════════
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_incident_resolve(t.zid('gl_i15'), 'withdrawn', 'oops');
  PERFORM t.check('a guard cannot withdraw a record', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%manager%', r::TEXT);
  r := public.mbg_zone_incident_resolve(t.zid('gl_i15'), 'settled', 'Paid UGX 2,000 cash at the gate on 23 Oct');
  PERFORM t.check('a guard marks it settled', r ->> 'success' = 'true' AND r #>> '{incident,status}' = 'settled', r::TEXT);
  r := public.mbg_zone_incident_resolve(t.zid('gl_i15'), 'settled');
  PERFORM t.check('...once', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%already settled%', r::TEXT);
  r := t.record(15);
  PERFORM t.check('settled stays on the public record, marked settled: paying makes it right, it does not make it disappear',
    (r ->> 'forced_entries')::INT = 1 AND (r ->> 'open')::INT = 0 AND r #>> '{incidents,0,status}' = 'settled', r::TEXT);
  r := public.mbg_zone_gate_peek(t.zid('gl'), t.code(15));
  PERFORM t.check('...and the gate''s warning now says all settled', EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'warnings') w WHERE w LIKE 'On record%(all settled)%'), r::TEXT);
END $$;
SELECT t.as_admin();
DO $$ BEGIN PERFORM t.check('the rider is told it is settled', EXISTS (SELECT 1 FROM public.push_log WHERE user_id = t.u(15) AND title = 'Settled at Gate lab')); END $$;

-- ═══ withdrawn: recorded in error ═══════════════════════════════════════════
SELECT t.login(4, 'manager@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_incident_resolve(t.zid('gl_i12'), 'withdrawn', 'Wrong car: this one was approved by the supervisor');
  PERFORM t.check('a manager withdraws a record that was made in error', r ->> 'success' = 'true' AND r #>> '{incident,status}' = 'withdrawn', r::TEXT);
  r := public.mbg_zone_incident_resolve(t.zid('gl_i12'), 'withdrawn');
  PERFORM t.check('...once', r ->> 'success' = 'false' AND r ->> 'error' LIKE '%already withdrawn%', r::TEXT);
  r := public.mbg_zone_incident_resolve(t.zid('gl_i15'), 'withdrawn');
  PERFORM t.check('a settled one can be withdrawn too', r ->> 'success' = 'true', r::TEXT);
END $$;
DO $$ DECLARE r JSONB; BEGIN
  r := t.record(12);
  PERFORM t.check('a withdrawn line leaves the public record entirely', (r ->> 'forced_entries')::INT = 0 AND jsonb_array_length(r -> 'incidents') = 0, r::TEXT);
  PERFORM t.check('...and rider 15''s too', (t.record(15) ->> 'forced_entries')::INT = 0);
END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_gate_peek(t.zid('gl'), t.code(12));
  PERFORM t.check('...and from the gate''s warning', NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(r -> 'warnings') w WHERE w LIKE 'On record%'), r::TEXT);
  PERFORM t.check('...and from the staff list', jsonb_array_length(public.mbg_zone_rider_incidents(t.code(12)) -> 'incidents') = 0);
END $$;
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('the row is kept for the audit trail, with who withdrew it and why',
    (SELECT status || '|' || resolution_note FROM public.mbg_access_incidents WHERE id = t.zid('gl_i12')) = 'withdrawn|Wrong car: this one was approved by the supervisor');
  PERFORM t.check('the rider is told it was withdrawn', EXISTS (SELECT 1 FROM public.push_log WHERE user_id = t.u(12) AND title = 'Withdrawn at Gate lab'));
END $$;

-- ═══ the same rider again, later ════════════════════════════════════════════
DO $$ BEGIN UPDATE public.mbg_access_incidents SET reported_at = now() - INTERVAL '40 minutes' WHERE id = t.zid('gl_i12'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(12), 'forced_entry');
  PERFORM t.check('after a withdrawn line the same vehicle can be reported again', r ->> 'success' = 'true' AND r ->> 'already_recorded' IS NULL, r::TEXT);
  INSERT INTO t.keep VALUES ('gl_i12b', r #>> '{incident,id}');
END $$;
SELECT t.as_admin();
DO $$ BEGIN UPDATE public.mbg_access_incidents SET reported_at = now() - INTERVAL '40 minutes' WHERE id = t.zid('gl_i12b'); END $$;
SELECT t.login(2, 'guard@x.test');
DO $$ DECLARE r JSONB; BEGIN
  r := public.mbg_zone_report_incident(t.zid('gl'), t.code(12), 'forced_entry');
  PERFORM t.check('forcing a gate again after half an hour is a second line', r ->> 'success' = 'true' AND r ->> 'already_recorded' IS NULL
                  AND (t.record(12) ->> 'forced_entries')::INT = 2 AND (r ->> 'recorded')::INT = 2, r::TEXT);
END $$;

-- ═══ the books still balance ════════════════════════════════════════════════
SELECT t.as_admin();
DO $$ BEGIN
  PERFORM t.check('no visit ever has more paid than due',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status NOT IN ('denied', 'cancelled') AND fee_paid_ugx > fee_due_ugx));
  PERFORM t.check('no vehicle is inside one zone twice',
    NOT EXISTS (SELECT 1 FROM public.mbg_access_visits WHERE status IN ('inside', 'awaiting_payment') GROUP BY zone_id, rider_id HAVING count(*) > 1));
  PERFORM t.check('IcanEra''s ledger still matches its wallet', (SELECT sum(amount_ican) FROM public.platform_fee_log) = t.biz_bal(900));
END $$;
