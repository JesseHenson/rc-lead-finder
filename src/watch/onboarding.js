// The interview and the scheduling walkthrough. Both are scripts Claude follows
// with the owner; the bundle stores the answers, it doesn't ask the questions.

import { profileGaps } from "./profile.js";

function steps(defaults) {
  const d = (v, label) => (v ? ` (default: ${v})` : label ? ` (${label})` : "");
  return [
    "## How to run this",
    "- One topic at a time. Offer a sensible default the owner can accept with a yes.",
    "- Look things up instead of asking where you can: their website, their Facebook page.",
    "- Nothing gets posted, and you never sign in for anyone. The owner signs in to their own accounts.",
    "- At the end, call `save_profile` once with everything. It can be called again any time.",
    "",
    "## 1. The business",
    `Business name${d(defaults.business_name)}, owner's first name, website${d(defaults.website)}, a phone number for replies, the Facebook page name, and the service area as towns or ZIP codes.`,
    "",
    "## 2. Services",
    "- **Offered now** — each with 3–6 words customers actually use. Customers name the thing and the problem, not the trade: \"driveway\", \"green fence\", \"mildew on the siding\", not only \"pressure washing\".",
    "- **Would consider adding** — nearby services they could take on. Suggest a few that fit the trade (for exterior cleaning: window cleaning, gutter cleaning, fence staining, concrete sealing, holiday lights).",
    "Save as `services: [{ name, kind: \"offered\" | \"considering\", keywords: [...] }]`.",
    "",
    "## 3. Where to look",
    "### Nextdoor",
    "Ask whether they have a Nextdoor account at their real home or business address. If yes, `navigate` to https://nextdoor.com/ in their Chrome and confirm they are signed in. Nextdoor only shows the area around the account's own address — never use anyone else's. If no, save `nextdoor_enabled: false`.",
    "### Facebook groups",
    "1. For each town, `navigate` to `https://www.facebook.com/search/groups/?q=<town>` and note each group's name, public or private, and members.",
    "2. For the 6–8 most local-looking groups, open the group and estimate posts per day from the newest posts' timestamps. A busy small group beats a big quiet one: in testing a 9.3K-member group had about 96 posts a day and a 17.1K-member group had less than one.",
    "3. Recommend the 3–6 liveliest and let the owner pick. Private groups need membership. Never join a group on your own; if the owner asks you to join one, first confirm it's their own account and that they've read the group's rules, then join only after they say yes.",
    "Save as `groups: [{ url, name, privacy, members, posts_per_day }]`.",
    "",
    "## 4. Search words",
    "Suggest terms and let the owner edit. Each term has a `platform` (facebook or nextdoor) and a `purpose`:",
    "- **lead** — what a customer would type. On Nextdoor people use the trade name (\"power washing\"). In Facebook groups they name the object or problem (\"driveway\", \"mildew\").",
    "- **competitor** — how providers advertise (\"free estimate\", the trade name).",
    "- **signal** — triggers for demand (\"HOA letter\", \"pollen\", \"hail\", \"moving\", \"party\").",
    "- **opportunity** — the services they would consider adding.",
    "Keep it small: 3–6 lead terms per platform. Each lead term runs once on Nextdoor and once in every chosen group; other terms run on Nextdoor and the two liveliest groups. A weekly sweep stops at 30 searches, so a profile of 4 groups and 5 Facebook lead terms already uses 20.",
    "",
    "## 5. Competitors",
    "Names and page links of competitors they already know. Optional — sweeps find more.",
    "",
    "## 6. Signals worth watching",
    "Default: weather damage, pollen or mildew, hosting or holidays, moving or selling, HOA notices. The owner adds or removes. Save as `signals: [...]`.",
    "",
    "## 7. How replies should sound",
    "One line, for example \"short, friendly, first person, no emojis\". Save as `reply_voice`. Replies always say who is writing and for which business, and nothing is ever posted automatically.",
    "",
    "## 8. How often",
    "- **Daily light** — lead searches only, a few minutes. Suggest early morning.",
    "- **Weekly deep** — every term, the weather, and a written analysis of competitors, signals, and opportunities. Suggest Monday morning.",
    "Save as `cadence: { daily: \"7:00 AM\", weekly: \"Monday 8:00 AM\" }`, leaving out one they don't want.",
    "",
    "## 9. Save, then prove it works",
    "1. Call `save_profile` with everything. Fix anything it rejects and call it again.",
    "2. Offer a first sweep now while the owner watches: `plan_sweep` with `mode: \"weekly\"`, then follow its instructions.",
    "3. Offer `serve_dashboard` to show the result.",
    "",
    "## 10. Put it on a schedule",
    "Call `setup_schedule` and follow its steps.",
  ];
}

export function onboardingScript(profile, { defaults = {} } = {}) {
  const intro = profile
    ? [
        `# Market watch: update the setup for ${profile.business_name}`,
        "",
        `Already saved. Still missing: ${profileGaps(profile).join("; ") || "nothing"}.`,
        "Call `show_profile`, give the owner a short summary, ask what they want to change, fill in anything missing, and call `save_profile` with only what changed. A list you send (services, groups, terms, competitors) will replace the saved list, so send the whole list when changing one item.",
      ]
    : ["# Market watch: first-time setup", "", "Nothing is saved yet. Walk the owner through each step below."];
  return [...intro, "", ...steps(defaults)].join("\n");
}

export function scheduleSetup(profile) {
  if (!profile) throw new Error("No profile yet. Run start_onboarding first.");
  const chosen = profile.cadence || {};
  const none = !chosen.daily && !chosen.weekly;
  const cadence = {
    daily: chosen.daily || (none ? "7:00 AM" : null),
    weekly: chosen.weekly || (none ? "Monday 8:00 AM" : null),
  };

  const prompt = mode => [
    `Run the ${mode} market watch for ${profile.business_name}.`,
    "1. Check that Claude in Chrome is connected. If it isn't, call save_report with markdown \"## Sweep skipped\" and one line saying Chrome wasn't connected, then stop.",
    `2. Call plan_sweep with mode "${mode}" and follow its instructions exactly, in Chrome.`,
    "3. Read only: never post, comment, react, message, or join anything.",
    "4. If a site shows a login page, skip that site and say so in the report. Never sign in.",
    "5. Finish with save_findings and save_report as the instructions say.",
  ].join("\n");

  const steps = [
    "## Set up the recurring tasks",
    "Every run needs: Claude Desktop open, the computer awake (a closed laptop lid counts as asleep), Chrome open and signed in to Facebook and Nextdoor, and Claude in Chrome connected. A run missed while the computer slept runs once when it wakes.",
    "If both schedules are used, keep the weekly at least an hour after the daily so two runs never share Chrome.",
    "",
    "1. If this conversation has a tool that creates scheduled tasks, offer to create one task per prompt with its schedule. Create it only after the owner says yes.",
    "2. Otherwise, walk the owner through it: in Claude Desktop, open scheduled tasks, create a new task, paste the prompt, set the schedule, and save.",
    "3. Open the new task and choose **Run now** while the owner watches. Each time Claude asks to use Claude in Chrome or this extension's tools, the owner chooses **Always allow**. Approvals belong to that one task, so do this once per task.",
    "4. Confirm the run ended with a report: `show_findings`, or `serve_dashboard` and the Today tab.",
  ].join("\n");

  return {
    cadence,
    daily_prompt: cadence.daily ? prompt("daily") : null,
    weekly_prompt: cadence.weekly ? prompt("weekly") : null,
    steps,
  };
}
