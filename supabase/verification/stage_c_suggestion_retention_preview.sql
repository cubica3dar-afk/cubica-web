-- SOLO LECTURA. Simula la política propuesta; no modifica datos. "Cierre" es
-- la última transición del estado actual a resolved/dismissed. Para registros
-- históricos sin transición se usa updated_at únicamente como aproximación y
-- el conteo se informa por separado para revisión humana.
with closure as(
  select s.*,
    case when s.status in('resolved','dismissed') then coalesce((
      select max(h.occurred_at)
      from private.suggestion_moderation_history h
      where h.suggestion_id=s.id and h.new_status=s.status
    ),s.updated_at) end as closed_at,
    case when s.status in('resolved','dismissed') and not exists(
      select 1 from private.suggestion_moderation_history h
      where h.suggestion_id=s.id and h.new_status=s.status
    ) then true else false end as estimated_closure
  from private.site_suggestions s
), deadlines as(
  select c.*,
    case when closed_at is null then created_at+interval '365 days'
      else least(closed_at+interval '90 days',created_at+interval '365 days') end as contact_deadline,
    case when closed_at is null then created_at+interval '730 days'
      else least(closed_at+interval '180 days',created_at+interval '730 days') end as notes_deadline
  from closure c
)
select
  count(*) filter(where contact is not null and contact_deadline<=now())
    as contacts_proposed_for_removal,
  count(*) filter(where contact is not null and closed_at is null and contact_deadline<=now())
    as open_contacts_at_ordinary_limit,
  count(*) filter(where private_notes<>'' and notes_deadline<=now())
    as notes_proposed_for_removal,
  count(*) filter(where private_notes<>'' and closed_at is null and notes_deadline<=now())
    as open_notes_at_ordinary_limit,
  count(*) filter(where deleted_at is not null and deleted_at+interval '365 days'<=now())
    as soft_deleted_proposed_for_anonymization,
  count(*) filter(where estimated_closure and (contact_deadline<=now() or notes_deadline<=now()))
    as candidates_requiring_closure_date_review
from deadlines;

select
  (select count(*) from private.suggestion_token_uses where expires_at<now())
    as expired_token_hashes,
  (select count(*) from private.suggestion_rate_limits
    where updated_at<now()-interval '2 days'
      and coalesce(blocked_until,'-infinity')<now())
    as expired_rate_hashes;
