-- XS Connect — a fuller sample data set for sales demos. Not exposed through the
-- API: an administrator runs `select private.seed_pitch('<workspace id>')`.

create function private.seed_pitch(p_ws uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid; v_k uuid; v_c uuid; v_seq int; v_item public.catalog_items; v_first text; v_at timestamptz; r record; v_n int := 0;
begin
  if not exists (select 1 from public.workspaces w where w.id = p_ws) then return 'workspace not found'; end if;
  if exists (select 1 from public.contacts c where c.workspace_id = p_ws and c.notes = 'pitch-demo') then return 'already seeded'; end if;

  insert into public.channels (workspace_id, kind, external_id, display_name, mode)
  select p_ws, k, 'demo-' || left(k, 2) || '-' || p_ws, 'Demo ' || initcap(k), 'demo'
  from unnest(array['whatsapp', 'instagram', 'messenger']) k
  on conflict (kind, external_id) do nothing;
  -- seed_demo names its channels demo-wa-/demo-ig-; reuse them when present.
  insert into public.catalog_items (workspace_id, kind, name, description, price_paise, unit)
  select p_ws, x.kind, x.name, x.description, x.price, x.unit
  from (values ('service', 'Starter package', 'One month, everything included', 250000, 'month'),
               ('service', 'Premium package', 'Three months with personal support', 650000, '3 months'),
               ('service', 'Annual package', 'Twelve months, two months free', 2200000, 'year'),
               ('service', 'Trial session', 'One guided session', 30000, 'session'),
               ('product', 'Welcome kit', 'Delivered anywhere in Kerala', 99900, 'each')) as x(kind, name, description, price, unit)
  where not exists (select 1 from public.catalog_items c where c.workspace_id = p_ws and c.name = x.name);
  if not exists (select 1 from public.knowledge_items k where k.workspace_id = p_ws) then
    insert into public.knowledge_items (workspace_id, title, body) values
      (p_ws, 'Do you deliver?', 'Yes, across Kerala in 2 to 4 working days. Delivery is free above ₹1,000.'),
      (p_ws, 'How can I pay?', 'UPI, card or cash on delivery. We send a payment link in this chat.'),
      (p_ws, 'Can I get a refund?', 'A full refund within the first 7 days of any package.'),
      (p_ws, 'Where are you?', 'MG Road, Kochi. Open Monday to Saturday, 6 am to 9 pm.');
  end if;
  update public.brand_profiles b set
    about = 'A studio in Kochi offering monthly, quarterly and annual packages, with a trial session for new customers.',
    services = 'Starter, Premium and Annual packages. Trial sessions. A welcome kit delivered across Kerala.',
    hours = 'Monday to Saturday, 6 am to 9 pm', location = 'MG Road, Kochi',
    policies = 'Full refund within 7 days. Payment by UPI, card or cash on delivery.',
    handoff_above_paise = 5000000, updated_at = now()
  where b.workspace_id = p_ws and b.about = '';

  for r in select * from (values
    ('Anjali Menon',   '+919000010001', 'whatsapp',  'won',       95, 'Starter package for two',   500000, 'Starter package', 2,  35,    'Payment done, thank you!', null),
    ('Rahul Krishnan', null,            'instagram', 'qualified', 60, 'Group of 5, wants a discount', 1250000, null,          0,  95,    'Can I get a discount for 5 people?', 'Asked for a group discount'),
    ('Fathima Rizwan', '+919000010003', 'whatsapp',  'proposal',  80, 'Premium package',           650000, 'Premium package', 1,  180,   'Ok, send me the payment link', null),
    ('Arjun Das',      '+919000010004', 'whatsapp',  'won',       90, 'Annual package',            2200000, 'Annual package', 1,  1500,  'Paid by UPI', null),
    ('Sneha Thomas',   null,            'messenger', 'qualified', 70, 'Corporate plan, 40 people', 10000000, null,            0,  260,   'We are 40 people. Any corporate rate?', 'Deal above your ₹50,000 limit'),
    ('Vishnu Prasad',  '+919000010006', 'whatsapp',  'new',       30, 'Asked about timings',       null,   null,              0,  20,    'What time do you open on Sunday?', null),
    ('Deepa Suresh',   '+919000010007', 'instagram', 'won',       85, 'Trial session, then Starter', 280000, 'Trial session', 1,  4300,  'See you on Monday', null),
    ('Mohammed Shafi', '+919000010008', 'whatsapp',  'lost',      40, 'Premium package',           650000, null,              0,  7200,  'Too far from my place, sorry', null),
    ('Priya Nair',     '+919000010009', 'messenger', 'proposal',  75, 'Welcome kit x 3',           299700, 'Welcome kit',     3,  600,   'Deliver to Aluva please', null),
    ('Akhil Raj',      null,            'instagram', 'new',       45, 'Saw the reel, asked price', null,   null,              0,  50,    'Price?', null),
    ('Meera Joseph',   '+919000010011', 'whatsapp',  'won',       88, 'Premium package',           650000, 'Premium package', 1,  10000, 'Thank you so much', null),
    ('Nikhil Varma',   '+919000010012', 'whatsapp',  'qualified', 65, 'Starter, will decide by Friday', 250000, null,         0,  1700,  'I will confirm by Friday', null)
  ) as t(name, phone, ch, stage, score, need, value, item, qty, mins, last_in, handoff) loop
    v_n := v_n + 1;
    v_at := now() - make_interval(mins => r.mins);
    v_first := split_part(r.name, ' ', 1);
    select c.id into v_ch from public.channels c
    where c.workspace_id = p_ws and c.kind = r.ch and c.mode = 'demo' order by c.created_at limit 1;
    insert into public.contacts (workspace_id, display_name, phone, notes, created_at)
    values (p_ws, r.name, r.phone, 'pitch-demo', v_at - interval '20 minutes') returning id into v_k;
    insert into public.contact_identities (workspace_id, contact_id, kind, external_id)
    values (p_ws, v_k, r.ch, 'pitch-' || v_n || '-' || p_ws);
    insert into public.conversations (workspace_id, channel_id, contact_id, contact_external, ai_enabled, handoff_reason,
                                      last_message_at, last_inbound_at, last_preview, unread, created_at)
    values (p_ws, v_ch, v_k, 'pitch-' || v_n || '-' || p_ws, r.handoff is null, r.handoff, v_at, v_at, r.last_in,
            case when r.handoff is not null then 1 else 0 end, v_at - interval '20 minutes')
    returning id into v_c;

    insert into public.messages (workspace_id, conversation_id, direction, sender, body, status, created_at) values
      (p_ws, v_c, 'in',  'contact', 'Hi, I wanted to ask about ' || lower(left(r.need, 1)) || substr(r.need, 2), 'received', v_at - interval '18 minutes'),
      (p_ws, v_c, 'out', 'ai', 'Hello ' || v_first || '! Happy to help. ' ||
         coalesce((select c.name || ' is ₹' || to_char(c.price_paise / 100, 'FM99,99,999') || coalesce(' per ' || c.unit, '') || '. '
                   from public.catalog_items c where c.workspace_id = p_ws and c.name = coalesce(r.item, 'Starter package') limit 1), '') ||
         'Shall I tell you more?', 'read', v_at - interval '17 minutes'),
      (p_ws, v_c, 'in',  'contact', r.last_in, 'received', v_at);
    if r.handoff is not null then
      insert into public.messages (workspace_id, conversation_id, direction, sender, body, status, created_at)
      values (p_ws, v_c, 'out', 'system', 'AI handed this chat to the team: ' || r.handoff, 'sent', v_at + interval '5 seconds');
    elsif r.stage = 'proposal' then
      insert into public.messages (workspace_id, conversation_id, direction, sender, body, status, created_at)
      values (p_ws, v_c, 'out', 'ai', 'Done, ' || v_first || '. Your order is booked and the payment link is on its way.', 'draft', v_at + interval '10 seconds');
    elsif r.stage in ('won', 'new', 'qualified') then
      insert into public.messages (workspace_id, conversation_id, direction, sender, body, status, created_at)
      values (p_ws, v_c, 'out', 'ai', case r.stage when 'won' then 'Thank you, ' || v_first || '! Payment received. See you soon.'
                                                   when 'new' then 'We are open Monday to Saturday, 6 am to 9 pm. Would you like a trial session?'
                                                   else 'Sure, ' || v_first || '. I will keep your spot and check with you then.' end,
              'read', v_at + interval '10 seconds');
      update public.conversations c set last_message_at = v_at + interval '10 seconds' where c.id = v_c;
    end if;

    insert into public.leads (workspace_id, contact_id, conversation_id, stage, score, need, value_paise, source, lost_reason,
                              created_at, updated_at, closed_at)
    values (p_ws, v_k, v_c, r.stage, r.score, r.need, r.value, r.ch,
            case when r.stage = 'lost' then 'Location' end, v_at - interval '20 minutes', v_at,
            case when r.stage in ('won', 'lost') then v_at end);

    if r.item is not null then
      select * into v_item from public.catalog_items c where c.workspace_id = p_ws and c.name = r.item limit 1;
      if v_item.id is not null then
        update public.workspaces w set order_seq = w.order_seq + 1 where w.id = p_ws returning order_seq into v_seq;
        insert into public.orders (workspace_id, contact_id, conversation_id, order_no, status, items, total_paise, created_by_ai, created_at)
        values (p_ws, v_k, v_c, 'XC-' || lpad(v_seq::text, 4, '0'),
                case when r.stage = 'won' then (array['paid', 'fulfilled'])[1 + v_n % 2] else 'pending' end,
                jsonb_build_array(jsonb_build_object('catalog_item_id', v_item.id, 'name', v_item.name, 'qty', r.qty, 'price_paise', v_item.price_paise)),
                v_item.price_paise * r.qty, true, v_at);
      end if;
    end if;

    insert into public.ai_runs (workspace_id, conversation_id, model, input_tokens, output_tokens, cached_tokens, outcome, created_at)
    values (p_ws, v_c, 'claude-haiku-5-5', 5200, 180, 3000, case when r.handoff is not null then 'handoff' else 'replied' end, v_at);
    insert into public.usage_events (workspace_id, conversation_id, day, amount_paise, from_trial, created_at)
    values (p_ws, v_c, (v_at at time zone 'Asia/Kolkata')::date, 0, true, v_at) on conflict do nothing;
  end loop;

  update public.wallets w set trial_conversations_left = greatest(0, 100 - v_n), updated_at = now() where w.workspace_id = p_ws;
  insert into public.followups (workspace_id, conversation_id, due_at, note, mode, created_by_ai)
  select p_ws, c.id, now() + x.due, x.note, 'staff', true
  from (values ('Nikhil Varma', interval '-2 hours', 'Nikhil said he would confirm by Friday. Check in.'),
               ('Rahul Krishnan', interval '3 hours', 'Reply with the group price for 5'),
               ('Sneha Thomas', interval '1 day', 'Send the corporate plan for 40 people')) as x(name, due, note)
  join public.contacts k on k.workspace_id = p_ws and k.display_name = x.name and k.notes = 'pitch-demo'
  join public.conversations c on c.contact_id = k.id;
  return 'seeded ' || v_n || ' conversations';
end;
$$;

revoke all on function private.seed_pitch(uuid) from public, anon, authenticated;
