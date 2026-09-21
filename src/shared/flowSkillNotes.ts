import type { SkillType } from './flowSkillSpecs';

export const NOTE_MAX_CHARS = 600;

export const SKILL_NOTES: Partial<Record<SkillType, string>> = {
  browser: 'Inside a loop ALWAYS set emitFailFlag="true". One dead link otherwise aborts the whole run, and a list step that already marked its items as seen will never hand them back — the batch is lost for good. Follow it with an if on {{<outputKey>.isFailed}} + continue to skip that item. The output is the WHOLE page body including navigation chrome, so tell a following llm step what part matters.',

  llm: 'Inside a loop set emitFailFlag="true" — one provider hiccup otherwise strands the whole batch. Put the data in the prompt by interpolation ({{browser_1}}), never ask the model to "fetch" or "open" anything: it has no tools here. Leave provider blank unless the flow genuinely needs a specific one.',

  bot: 'Inside a loop set emitFailFlag="true": a transient send error otherwise kills the run after the list was already consumed. Telegram caps a photo caption at 1024 chars and a text message at 4096; LINE has no upload API, so only a public https .jpg/.png URL arrives as an image and text is cut at 5000. To send a file produced earlier, reference {{file}} — not that step\'s outputKey.',

  rss: 'Returns titles and links ONLY, deliberately. Do not try to summarize the array in one llm step: N articles in one prompt hits the input cap, N summaries in one message hits the messenger cap, and one failure loses the whole batch that the seen-cache has already marked as read. The correct shape is rss → stop → loop → browser → llm → bot → end_loop, one article at a time.',

  scraper: 'itemSelector, titleSelector and linkSelector must describe ONE repeating row: the title and link selectors are resolved INSIDE each itemSelector match. Picking them from two unrelated parts of the page makes them hit different element sets and pairs the wrong title with the wrong link. Leave linkSelector blank when the row itself is the anchor — that is the normal case for card lists.',

  search: 'Stateless: the same query returns the same results every run, with no cross-run de-duplication. For "tell me when something NEW appears" use rss or scraper instead — search will re-report the same hits forever. It never aborts the flow; a failure logs and returns "[]", so follow it with a stop step if an empty result should end the run.',

  research: 'The main output is prose, not a list — never loop over it. To walk the pages it read, loop over {{<outputKey>.sources}} instead. One call per distinct sub-question beats one broad call: it plans and reads on its own, so two focused questions cover a topic better than one vague one.',

  http: 'The output is the raw response body as text with no sub-variables, for ANY status code. If the body is JSON, parse it in a following js step and return just the field you need — referencing {{<outputKey>.something}} does not work here.',

  js: 'Earlier step outputs are in scope as BARE identifiers named by their outputKey (rss_1, llm_1) — not as {{rss_1}}. Parse a JSON array output with JSON.parse before using it. Return an array to drive a following loop; return "" to let a following stop step halt the run.',

  browser_js: 'Requires a page handle from an earlier browser_open — set page to that step\'s {{outputKey}}. The code runs in the page, so no Node APIs and no {{variables}} inside the code body. End with `return value`. A screenshot() path comes back through this step\'s own output; it does NOT set {{file}}.',

  loop: 'An OBJECT item exposes every field as {{<loopVar>.<field>}} (e.g. {{item.title}}, {{item.link}}); a STRING item is just {{<loopVar>}}. Match this to the OUTPUT shape of the step feeding it. Every step inside the loop that can fail — browser, llm, bot, research — needs emitFailFlag="true", or one bad item ends the whole run.',

  stop: 'Its meaning depends on where it sits: at the top level an empty value stops the entire flow, inside a loop it only skips the current item and moves on. Put one right after rss / scraper / search / youtube_subs so a run with nothing new ends quietly instead of sending an empty message.',

  youtube: 'Captions fail often — private videos, no subtitles, a bad URL. Always branch on {{<outputKey>.isFailed}} with an if + continue before the summarizing step. {{<outputKey>.image}} is derived from the URL, so it is still usable as a bot attachment even when the transcript failed.',

  on_change: 'An edge trigger, not a comparison. Feed it a small marker ("hit" or "") from a js step, not a whole page, and follow it with stop: the flow then fires once when the condition starts holding instead of every run it keeps holding. Dropping back below the threshold stores "" and re-arms it. State is keyed to this step, so replacing the step resets it.',

  gmap_reviews: 'The place-level fields ({{<outputKey>.rating}}, .total, .distribution, .verdict) are read from the rendered place page and are "" if it could not be read — they are NOT present in the individual reviews. Feed the whole array plus those fields into one llm step for analysis; looping over hundreds of reviews one at a time is almost never what is wanted.',

  file_write: 'A terminal action with no outputKey. The path it wrote is available to LATER steps as the magic {{file}} — that is what a following bot, email_send or file_delete step must reference. The same is true of capture, file_download, share, and an llm step with exportFormat set; {{file}} always points at the most recent one.',

  capture: 'A terminal action with no outputKey — the image path is available to later steps as the magic {{file}}. To send the screenshot, put a bot step after it referencing {{file}}, then a file_delete on {{file}} to clean up.',

  file_download: 'A terminal action with no outputKey — the saved path is the magic {{file}}. The extension comes from the response Content-Type, which is what lets a following bot step route an image as a photo rather than a document.',

  share: 'Use this, not file_write, whenever the user asks for a PDF, a picture of some text, a document to send, or a link to share. For a file format the path is also set as {{file}}; for format "text" it returns a URL and {{file}} is NOT set — branch on {{<outputKey>.kind}} if the format can vary.',

  file_list: 'Returns {title, link} where title is the file name and link is the full path — loop over it and pass {{item.link}} to file_read or file_delete. Non-recursive and files only, so subfolders are not walked.',

  youtube_subs: 'Returns {title, link, image} per video, so the loop body uses {{<loopVar>.link}} for a youtube step and {{<loopVar>.image}} as a bot attachment. A newly added channel is seeded with only its latest video, so adding one never floods the first run.',

  weather: 'The geocoder matches Latin-script place names only — "Kaohsiung" works, "高雄市" / "東京" / "서울" return nothing. Never throws: an unknown place sets {{<outputKey>.isFailed}}="1", so branch on that rather than expecting an error.',

  air_quality: 'The geocoder matches Latin-script place names only, same as weather. Compare {{<outputKey>.level}} numerically (1 Good … 6 Hazardous, 0 = no reading) rather than matching the .status text, which is always English.',

  email_send: 'A pure sink with no outputKey. SMTP credentials come from the app settings and are never written into the flow, so a flow using this is safe to export or share — but it does nothing on a machine where email has not been configured. attachments takes LOCAL PATHS ONLY, normally {{file}} from an earlier step; a URL there is rejected, so fetch it with file_download first and attach {{file}}.',

  shell: 'Runs with the user\'s full privileges and its output is whatever the command printed. Prefer a purpose-built skill when one exists (http for APIs, file_read for files) and keep shell for work that genuinely needs the system.',

  text: 'Its value is a plain string, so a bot step sends it as a text message, not a file. Use it to compose a message out of several earlier outputs in one place instead of repeating the same interpolation in every downstream step.',
};
