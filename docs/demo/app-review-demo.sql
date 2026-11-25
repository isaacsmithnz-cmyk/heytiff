-- THE APP REVIEW DEMO BUSINESS (Isaac, 26 November 2026: "Yes", to a demo
-- business with made-up data for Apple's reviewer).
--
-- Apple signs in to review the app and needs a business to look at. This is
-- one: Demo Air Conditioning, with four made-up people, eight made-up
-- customers, twelve jobs and a booking or two every day. Every name, address,
-- email and phone here is invented (emails on example.com, the phone in the
-- 02 5550 range set aside for fiction). Nothing in it is anyone's real data.
--
-- THE REVIEWER IS STAFF, NOT THE OWNER, so More › Delete account works for
-- them: an owner is refused (api/mobile/me). The owner is a placeholder login
-- that no one can sign in as.
--
-- WHY THE PHONE SEES JOBS WITHOUT SERVICEM8: Jobs and the day read the
-- ServiceM8 copy (sm8_*), and a person's bookings are found through their
-- link to a ServiceM8 staff member under the connection's tenant. So the
-- demo holds a ServiceM8 connection row with a made-up tenant, PARKED at
-- `needs_reauth` with no tokens and writes `off`: every sync, sweep and
-- send skips a connection that isn't `connected`, so nothing ever reaches
-- ServiceM8 and nothing overwrites the made-up copy.
--
-- RUN AGAIN to move the bookings on (they run from 10 days ago to 60 days on,
-- counted from the day it is run) or after the reviewer deleted their account:
-- make a new login, put its Auth0 id in v_reviewer below and run the whole
-- file. Every row has a fixed id, so a re-run updates in place.

do $$
declare
  v_reviewer text := 'auth0|6b076b0b1ad6bfff76f88612';
  v_reviewer_email text := 'isaacsmithnz1+appreview@gmail.com';
  v_owner text := 'demo|app-review-owner';
  v_org uuid := 'de300000-0000-4000-8000-000000000001';
  v_tenant text := 'de300000-0000-4000-8000-00000000d001';
  v_now text := to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI:SS');
begin
  -- the business, and its placeholder owner
  insert into profiles (user_id, email, name) values (v_owner, 'owner@example.com', 'Jordan Lee')
    on conflict (user_id) do nothing;
  insert into organizations (id, name, trading_name, primary_owner_user_id, email, phone, address, suburb, state, postcode, plan, setup_completed_at, live_location)
    values (v_org, 'Demo Air Conditioning', 'Demo Air Conditioning', v_owner, 'office@example.com', '02 5550 1234', '1 Demo Street', 'Sydney', 'NSW', '2000', 'unlimited', now(), true)
    on conflict (id) do update set name = excluded.name, trading_name = excluded.trading_name, setup_completed_at = coalesce(organizations.setup_completed_at, now());
  insert into memberships (user_id, org_id, role) values (v_owner, v_org, 'owner')
    on conflict (user_id, org_id) do nothing;

  -- the reviewer's login: a member at the staff role
  insert into profiles (user_id, email, name) values (v_reviewer, v_reviewer_email, 'Alex Taylor')
    on conflict (user_id) do update set email = excluded.email, name = excluded.name;
  insert into memberships (user_id, org_id, role) values (v_reviewer, v_org, 'staff')
    on conflict (user_id, org_id) do update set role = 'staff';

  -- the team's cards; the reviewer's is Alex Taylor
  insert into staff_profiles (id, org_id, user_id, full_name, first_name, last_name, job_title, employment_type, pay_basis, state, status, start_date, contact_email, onboarded_at)
  values
    ('de300000-0000-4000-8000-0000000000a1', v_org, v_reviewer, 'Alex Taylor', 'Alex', 'Taylor', 'Air conditioning technician', 'Full-time', 'hourly', 'NSW', 'Active', current_date - 400, 'alex.taylor@example.com', now()),
    ('de300000-0000-4000-8000-0000000000a2', v_org, v_owner, 'Jordan Lee', 'Jordan', 'Lee', 'Owner', 'Full-time', 'salary', 'NSW', 'Active', current_date - 2000, 'owner@example.com', now()),
    ('de300000-0000-4000-8000-0000000000a3', v_org, null, 'Priya Shah', 'Priya', 'Shah', 'Senior technician', 'Full-time', 'hourly', 'NSW', 'Active', current_date - 900, 'priya.shah@example.com', now()),
    ('de300000-0000-4000-8000-0000000000a4', v_org, null, 'Ben Walker', 'Ben', 'Walker', 'Apprentice', 'Full-time', 'hourly', 'NSW', 'Active', current_date - 200, 'ben.walker@example.com', now())
  on conflict (id) do update set user_id = excluded.user_id, status = 'Active';

  -- the parked ServiceM8 connection (see the note at the top)
  insert into integration_connections (org_id, provider, status, tenant_id, tenant_name, tenants, connected_at, connected_by_user_id, write_mode)
    values (v_org, 'servicem8', 'needs_reauth', v_tenant, 'Demo Air Conditioning',
            jsonb_build_array(jsonb_build_object('tenantId', v_tenant, 'tenantName', 'Demo Air Conditioning', 'timezoneName', 'Australia/Sydney')),
            now(), v_owner, 'off')
    on conflict (org_id, provider) do update set status = 'needs_reauth', write_mode = 'off', access_token_enc = null, refresh_token_enc = null;
  insert into sm8_vendor (org_id, uuid, name, email, timezone_name, currency, synced_at)
    values (v_org, v_tenant, 'Demo Air Conditioning', 'office@example.com', 'Australia/Sydney', 'AUD', now())
    on conflict (org_id) do nothing;

  insert into sm8_staff (org_id, uuid, first, last, job_title, active, edit_date, synced_at) values
    (v_org, 'de300000-0000-4000-8000-00000000e0a1', 'Alex', 'Taylor', 'Air conditioning technician', 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000e0a2', 'Jordan', 'Lee', 'Owner', 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000e0a3', 'Priya', 'Shah', 'Senior technician', 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000e0a4', 'Ben', 'Walker', 'Apprentice', 1, v_now, now())
  on conflict (org_id, uuid) do nothing;

  insert into integration_links (org_id, provider, kind, tenant_id, staff_profile_id, remote_id, remote_label, matched_by, linked_by_user_id)
  select v_org, 'servicem8', 'staff', v_tenant, ('de300000-0000-4000-8000-0000000000' || k)::uuid, 'de300000-0000-4000-8000-00000000e0' || k, n, 'manual', v_owner
  from (values ('a1', 'Alex Taylor'), ('a2', 'Jordan Lee'), ('a3', 'Priya Shah'), ('a4', 'Ben Walker')) s(k, n)
  on conflict (org_id, provider, kind, tenant_id, staff_profile_id) do nothing;

  -- the customers
  insert into sm8_companies (org_id, uuid, name, address, is_individual, active, edit_date, synced_at) values
    (v_org, 'de300000-0000-4000-8000-00000000c001', 'Margaret Ellis', E'14 Kingfisher Way\nChatswood NSW 2067', 1, 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000c002', 'Harbourside Dental', E'Suite 3, 88 Pacific Parade\nManly NSW 2095', 0, 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000c003', 'Tom and Grace Nguyen', E'7 Banksia Close\nCastle Hill NSW 2154', 1, 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000c004', 'Westgate Childcare', E'220 Ridge Road\nParramatta NSW 2150', 0, 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000c005', 'Daniel Okafor', E'31 Lyrebird Crescent\nCronulla NSW 2230', 1, 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000c006', 'Bellview Body Corporate', E'5 Shoreline Drive\nRhodes NSW 2138', 0, 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000c007', 'Sophie Martin', E'62 Ironbark Avenue\nPenrith NSW 2750', 1, 1, v_now, now()),
    (v_org, 'de300000-0000-4000-8000-00000000c008', 'Northside Physio', E'41 Station Lane\nHornsby NSW 2077', 0, 1, v_now, now())
  on conflict (org_id, uuid) do update set name = excluded.name, address = excluded.address;

  -- the jobs: three done, six to do, three to quote
  -- (job_number is generated from generated_job_id)
  insert into sm8_jobs (org_id, uuid, generated_job_id, status, company_uuid, job_address, geo_city, geo_state, geo_postcode, lat, lng,
                        date, quote_date, work_order_date, completion_date, job_description, total_invoice_amount, payment_received, active, edit_date, synced_at)
  select v_org, 'de300000-0000-4000-8000-00000000b' || lpad(n::text, 3, '0'), (1000 + n)::text, st,'de300000-0000-4000-8000-00000000c' || lpad(c::text, 3, '0'),
         addr, city, 'NSW', pc, lat, lng,
         to_char(current_date - ago, 'YYYY-MM-DD') || ' 00:00:00',
         case when st = 'Quote' then to_char(current_date - ago, 'YYYY-MM-DD') || ' 09:00:00' end,
         case when st <> 'Quote' then to_char(current_date - ago, 'YYYY-MM-DD') || ' 09:00:00' end,
         case when st = 'Completed' then to_char(current_date - ago + 3, 'YYYY-MM-DD') || ' 15:30:00' end,
         descr, to_char(amount, 'FM999990.0000'), case when st = 'Completed' then 1 else 0 end, 1, v_now, now()
  from (values
    (1,  'Completed',  1, E'14 Kingfisher Way\nChatswood NSW 2067',         'Chatswood',   '2067', -33.7969, 151.1803, 30, 'Service and clean two split systems: filters washed, coils cleaned, drains flushed.', 330.00),
    (2,  'Completed',  2, E'Suite 3, 88 Pacific Parade\nManly NSW 2095',    'Manly',       '2095', -33.7970, 151.2856, 26, 'Replace the failed condenser fan motor on the 14 kW ducted unit.', 1180.00),
    (3,  'Completed',  4, E'220 Ridge Road\nParramatta NSW 2150',           'Parramatta',  '2150', -33.8150, 151.0011, 21, 'Quarterly service of four ceiling cassette units.', 880.00),
    (4,  'Work Order', 3, E'7 Banksia Close\nCastle Hill NSW 2154',         'Castle Hill', '2154', -33.7310, 151.0040, 12, 'Supply and install a 7.1 kW split system in the main bedroom. Back-to-back, outdoor unit on the side wall.', 2890.00),
    (5,  'Work Order', 5, E'31 Lyrebird Crescent\nCronulla NSW 2230',       'Cronulla',    '2230', -34.0550, 151.1520, 9,  'Lounge split not cooling and flashing an error code. Find the fault and repair.', 0),
    (6,  'Work Order', 6, E'5 Shoreline Drive\nRhodes NSW 2138',            'Rhodes',      '2138', -33.8300, 151.0870, 8,  'Common-area ducted system: zone damper stuck on level 2. Replace the damper motor.', 640.00),
    (7,  'Work Order', 7, E'62 Ironbark Avenue\nPenrith NSW 2750',          'Penrith',     '2750', -33.7510, 150.6940, 6,  'Service the three-zone ducted system and fit a new wall controller.', 520.00),
    (8,  'Work Order', 8, E'41 Station Lane\nHornsby NSW 2077',             'Hornsby',     '2077', -33.7030, 151.0990, 5,  'Install two 2.5 kW split systems in the treatment rooms.', 4150.00),
    (9,  'Work Order', 4, E'220 Ridge Road\nParramatta NSW 2150',           'Parramatta',  '2150', -33.8150, 151.0011, 3,  'Yearly check of the air conditioning isolators and condensate pumps.', 410.00),
    (10, 'Quote',      1, E'14 Kingfisher Way\nChatswood NSW 2067',         'Chatswood',   '2067', -33.7969, 151.1803, 4,  'Quote to replace the 15-year-old lounge split with an 8 kW inverter unit.', 0),
    (11, 'Quote',      2, E'Suite 3, 88 Pacific Parade\nManly NSW 2095',    'Manly',       '2095', -33.7970, 151.2856, 2,  'Quote for a four-zone ducted system for the new surgery fit-out.', 0),
    (12, 'Quote',      5, E'31 Lyrebird Crescent\nCronulla NSW 2230',       'Cronulla',    '2230', -34.0550, 151.1520, 1,  'Quote to add a split system to the garage gym.', 0)
  ) j(n, st, c, addr, city, pc, lat, lng, ago, descr, amount)
  on conflict (org_id, uuid) do update set status = excluded.status, date = excluded.date, quote_date = excluded.quote_date,
    work_order_date = excluded.work_order_date, completion_date = excluded.completion_date, job_description = excluded.job_description,
    total_invoice_amount = excluded.total_invoice_amount, payment_received = excluded.payment_received, edit_date = excluded.edit_date;

  -- the bookings, from 10 days ago to 60 days on: Alex has two a weekday and
  -- one each weekend day (so a review on any day finds a day to look at),
  -- Priya one a weekday. They cycle through the six jobs still to do.
  delete from sm8_job_activities where org_id = v_org;
  insert into sm8_job_activities (org_id, uuid, job_uuid, staff_uuid, start_date, end_date, activity_was_scheduled, active, edit_date, synced_at)
  select v_org,
         'de300000-0000-4000-8000-' || lpad(to_hex(row_number() over (order by d, slot)), 12, '0'),
         'de300000-0000-4000-8000-00000000b' || lpad((4 + ((extract(doy from d)::int * 2 + slot) % 6))::text, 3, '0'),
         'de300000-0000-4000-8000-00000000e0' || who,
         to_char(d, 'YYYY-MM-DD') || ' ' || starts, to_char(d, 'YYYY-MM-DD') || ' ' || ends, 1, 1, v_now, now()
  from generate_series(current_date - 10, current_date + 60, interval '1 day') g(d)
  cross join (values (0, 'a1', '08:00:00', '10:30:00'), (1, 'a1', '12:00:00', '15:00:00'), (2, 'a3', '09:00:00', '12:00:00')) s(slot, who, starts, ends)
  where extract(isodow from d) < 6 or slot = 0;
end $$;
