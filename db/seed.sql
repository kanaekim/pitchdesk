-- Kathy Slowinski / The AI Boss guest profile. Only inserts if settings are empty.
insert into settings (
  id, guest_name, sender_name, offer, proof, ask, topics, voice, signature,
  subject_lines, discovery_terms
) values (
  1,
  'Kathy Slowinski',
  'Kathy Slowinski',
  $$Kathy Slowinski, The AI Boss, as a guest for podcasts whose listeners are CEOs, board members, and business owners. Any industry, anywhere. Shows with YPO audiences are a priority.

Kathy is a sitting CEO running a $110M software company with 25 people. She spent three years rebuilding it with AI, department by department: support, renewals, engineering, finance, product. Her take: AI transformation is 80% change management and 20% tools. She gives away the whole playbook, mistakes included. Nothing she does is a secret. It's just hard.$$,
  $$Sitting CEO of Trilogy: $110M in revenue with 25 people, about $4.4M per employee. 80% of customer support handled by AI. A 3M-line legacy codebase cut to 125K. Margins up 15 points, from 60% to 75%. About 150 consecutive weekly Weds.ai hackathons. YPO AI Champion.$$,
  $$Ask one question: "Would your listeners want the real story of running a $110M company with 25 people, mistakes included?" If yes, they reply and we send topics and dates. Reply only. No calendar link.$$,
  $$- AI is 80% change management, 20% tools. The mind shift is the hard part.
- Monkey see, monkey do. If the CEO doesn't go first, nobody follows.
- Beat the drum. About 150 Weds.ai sessions. They cancelled it more than once and the team asked for it back every time.
- We did tools first, and it was a mistake. Context and clean data matter more than tools.
- Here's the whole playbook. Giving it away isn't a risk, because by the time someone copies it, we're on the next version.
- This is a 20-year shift, not a 2-year one.
- Why we built our own orchestration layer.$$,
  $$Short declarative sentences. Proof before claims. "Not X" contrasts ("not a pilot, an operating model"). Plain words, no hype, no exclamation marks. Sounds like a CEO writing to a peer, not a publicist. Lowercase subject lines.$$,
  $$Kathy Slowinski
CEO, Trilogy | The AI Boss
theaiboss.ai$$,
  '["guest idea: $110m with 25 people", "a sitting ceo, not an ai consultant", "why ai pilots are a waste of time", "episode idea: the 25-person $110m company", "ceo guest for {{podcast}}"]'::jsonb,
  '["CEO interviews leadership", "board directors governance", "YPO", "AI for executives", "SaaS CEO founders", "business owners growth", "future of work leadership", "operations scaling company"]'::jsonb
) on conflict (id) do nothing;
