/**
 * What the Taiwan rail connector's tool descriptions cannot say on their own. Its tools need no
 * contract table: all are read-only and say so in their annotations.
 */
export const RAIL_NOTES = [
  'TAIWAN RAIL NOTES:',
  '- Train times, delays and fares come only from these tools, never from memory.',
  '- 火車 or 台鐵 alone means TRA: pass modes "tra"; 高鐵 alone means modes "thsr". Compare both only when neither is named or the user asks which.',
  '- A TRA-only plan is one ticket (its ticket.fare_ntd); never add up its legs. For "how much is the train", answer from tra_fares, every class.',
  '- Leave date and time out unless the user named them: the tools know Taipei\'s current time, so never guess one (12:00) or look up the clock another way. When the question is about now, state query_time from the result in the answer.',
  '- A bare 4-digit number before a trip ("1016 左營到南港") is a date (October 16); a number with 次 or 車次 is a train. Ask only when both readings fit.',
  '- End with the official_links as Markdown links and say the operators\' own pages are authoritative; when live says data is unavailable or old, say so. "needs a TDX key" means the user has not set one: say that seats or notices are not shown; rail_train still gives one TRA train\'s live position.',
  '- 捷運, MRT, 輕軌, 機捷 and metro questions use the metro_ tools, even when a station shares a TRA name (鶯歌車站); rail_trip is only THSR and TRA. Two places → one metro_trip with both, which plans the transfers between lines and operators itself (大坪林 → 鶯歌車站 via 頂埔): never split it into legs or swap a leg for TRA; one station (下一班, 末班, 首班) → metro_station; who pays what (兒童, 學生, 敬老, 一日票, TPASS) → metro_tickets; a route map → metro_map; is there a metro / when does a line open (八德, 基隆, 新竹) → metro_station with the place, which answers not_open for lines not in service. Never state metro stations, fares, opening dates or maps from memory.',
  '- Pass places exactly as the user wrote them, system words included (桃園綠線G07, 機捷台北車站, 景文科大): the tools know station names, typos, a few landmarks and every line not open yet. Only when a tool cannot place a landmark, pass the station nearest it.',
  '- Metro names: read_as means a typo was read; say which station you used. Close names: if one is plainly what the user meant (中山國忠 → 中山國中), use it and say so; otherwise ask. one_place_on = a transfer station: answer for the system the user means, or both. same_name_in_different_cities = ask which city. not_open = a line not in service: give its official status, never fares or times.',
  '- metro_trip totals are already added up (total_card_fare_ntd with the card discount off, total_concession_ntd per ticket kind); quote them, never add legs yourself. No departures means the operator publishes none for that time; say so instead of guessing.',
  '- A metro map is attached as a picture by itself: never write image Markdown; give the official page link.',
  '- metro_status: read recent_notices too — a typhoon or works notice for tomorrow matters even when today\'s line says normal; say what it changes from its excerpt (which trains, headways, hours) and link it. Only a single system\'s notices have excerpts: ask for that system to read one.',
].join('\n');
