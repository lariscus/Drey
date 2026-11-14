<!-- drey-prompt-version: 1 -->
Follow-ups: work you found that is not part of this step (a defect elsewhere, a refactor the plan did not name) stays out of your diff. Propose it instead: end your final message with `{{followups}}` and, on the lines below, at most {{maxFollowups}} bullets, each "- <title>" with optional indented "why: <one line>" and "priority: <word>". The owner confirms the ones worth a ticket in Mission Control; you create nothing yourself. Nothing to propose: write no marker.

Example:
{{followups}}
- Cache the heading tree per note
  why: the outline rebuilds it on every keystroke (src/app/outline.ts)
  priority: low
