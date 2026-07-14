create or replace view commercial_dashboard as
with market as (
  select
    (select primary_objection from interactions
       group by primary_objection order by count(*) desc limit 1) as top_objection,
    (select dominant_unresolved_belief from interactions
       group by dominant_unresolved_belief order by count(*) desc limit 1) as top_belief,
    (select activation_event from interactions
       group by activation_event order by count(*) desc limit 1) as top_activation_event
),
pipeline as (
  select
    count(*) filter (where outcome_type = 'exec_meeting') as exec_meetings,
    count(*) filter (where outcome_type = 'irr_started') as irrs_started,
    count(*) filter (where outcome_type = 'membership_discussion') as membership_discussions,
    count(*) filter (where outcome_type = 'membership_closed') as memberships_closed
  from commercial_outcomes
  where occurred_at > now() - interval '90 days'
),
current_campaign as (
  select
    b.belief_statement as current_belief,
    o.objection_statement as current_objection,
    ae.event_type as current_activation_event,
    c.decision_type as current_decision_type,
    c.campaign_id
  from campaigns c
  left join beliefs b on b.belief_id = c.belief_id
  left join objections o on o.objection_id = c.objection_id
  left join activation_events ae on ae.activation_event_id = c.activation_event_id
  where c.status = 'active'
  order by c.created_at desc
  limit 1
)
select
  m.top_belief          as market_most_common_unresolved_belief,
  m.top_objection        as market_most_common_objection,
  m.top_activation_event as market_most_common_activation_event,
  p.exec_meetings          as pipeline_executive_meetings,
  p.irrs_started            as pipeline_irrs_started,
  p.membership_discussions   as pipeline_membership_discussions,
  p.memberships_closed        as pipeline_memberships_closed,
  cc.current_belief             as campaign_current_belief,
  cc.current_objection            as campaign_current_objection,
  cc.current_activation_event      as campaign_current_activation_event,
  cc.current_decision_type          as campaign_current_decision_type
from market m, pipeline p
left join current_campaign cc on true;