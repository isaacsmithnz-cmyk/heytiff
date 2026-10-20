import { looksLikeDesignWords, looksLikeQuestion, priceIntent } from "../intent";

/* The question/note split. The asymmetry these pin: a false "question" EATS
   A NOTE — the words go to the answer loop and nothing is saved — while a
   false "note" merely shows someone their own question on a review card,
   one Discard away. So every ambiguous case below must land on note. */

describe("things that are questions", () => {
  it.each([
    ["what's outstanding at Meridian"],
    ["whats left on the smith st job"],
    ["how many open tasks does Lyle have"],
    ["who's booked for Thursday"],
    ["where is the roof key at Meridian"],
    ["is there anything open on the CRAC job"],
    ["do we have a manual for the PUZ-ZM250"],
    ["has anyone looked at the E6 on RTU-2"],
    ["show me the recurring issues"],
    ["tell me about the Meridian job"],
    ["did we ever fix that compressor"],
    ["the crane is booked for tomorrow right?"],
  ])("%j asks", (text) => {
    expect(looksLikeQuestion(text)).toBe(true);
  });
});

describe("things that are notes, however question-shaped", () => {
  it.each([
    // request modals are TASKS — "can you" to the widget means "someone should"
    ["can you order the grilles for smith st"],
    ["could someone chase the supplier"],
    ["should get the belts replaced next visit"],
    // "tell Lyle" is a task; only "tell me" asks
    ["tell Lyle he needs to order the grilles"],
    // a question buried mid-note belongs to the note
    ["gate code changed, and ask Dane what's left on the list"],
    // plain statements that happen to open with an s-word
    ["isolated the unit and reset the board"],
    ["showed the apprentice the plant room"],
    ["the middle rooftop unit tripped again"],
    ["gate code 4417"],
    [""],
    ["   "],
  ])("%j records", (text) => {
    expect(looksLikeQuestion(text)).toBe(false);
  });
});

/* The same split in the other languages spoken on site. Speech comes back in
   whatever was said and is never translated, so before these every one of
   them fell through to the note flow and landed on a review card. */

describe("questions in the other languages", () => {
  it.each([
    // Spanish — the accent is what separates the question word from the
    // conjunction, and ¿ is carried by nothing but a question
    ["dónde está la llave del techo"],
    ["¿hay algo abierto en el trabajo de Meridian"],
    ["cuántas tareas tiene Lyle"],
    ["por qué saltó el diferencial"],
    // Vietnamese — the marker trails
    ["máy lạnh sửa xong chưa"],
    ["khi nào có phụ tùng"],
    ["chìa khóa mái ở đâu"],
    // Chinese — trailing particle, and wh-words that stay where they fell
    ["空调修好了吗"],
    ["什么时候有配件"],
    ["屋顶钥匙在哪里"],
    // Arabic
    ["أين مفتاح السطح"],
    ["هل يوجد شيء مفتوح في ميريديان"],
    // Tagalog
    ["saan yung susi ng bubong"],
    ["bakit nag-trip yung unit"],
    // and a question mark in any script is still a question mark
    ["ماذا حدث؟"],
    ["还有什么没做完？"],
  ])("%j asks", (text) => {
    expect(looksLikeQuestion(text)).toBe(true);
  });
});

describe("notes in the other languages, however question-shaped", () => {
  it.each([
    /* Every one of these is a NOTE, and each is here because a plausible cue
       list would have eaten it. The asymmetry does not soften abroad. */
    // "hay que" is an obligation — "the filter has to be changed"
    ["hay que cambiar el filtro del rooftop"],
    // "cuando" without the accent opens a statement: "when I arrived…"
    ["cuando llegué la unidad ya estaba apagada"],
    // "porque" is because, not why
    ["no arrancó porque el térmico estaba disparado"],
    // Vietnamese "không" is also plain negation, mid-sentence
    ["máy lạnh không hoạt động từ sáng"],
    // Chinese 没什么 is "nothing wrong"; 几个 is "a few"
    ["检查过了没什么问题"],
    ["换了几个滤网"],
    // Tagalog "may" collides with English "may", and bare "ano" is a filler
    ["may problema sa condenser unit"],
    // "ilan" is Tagalog for "how many" and also a first name — a note that
    // opens with somebody's name is the commonest note there is
    ["Ilan needs to order the grilles for smith st"],
    // a task, not a question, in Spanish
    ["dile a Lyle que pida las rejillas"],
  ])("%j records", (text) => {
    expect(looksLikeQuestion(text)).toBe(false);
  });
});

/* With a design open, words about its building go to Tiff (Isaac, 20
   October 2026): "the kitchen ceiling is 2.7, fix it" was offered as a task. */
describe("a design's words", () => {
  it.each([["The 3D is wrong: the kitchen ceiling is 2.7 m, please fix it"], ["make it a hip roof at 25 degrees"], ["the eaves are 450"], ["Bed 2 is raked"]])(
    "%j is about the design",
    (text) => expect(looksLikeDesignWords(text)).toBe(true),
  );
  it.each([["remind me to call Jack tomorrow"], ["Lyle has the head on the ute"]])("%j is not", (text) =>
    expect(looksLikeDesignWords(text)).toBe(false),
  );
});

/* Price now, a task, or ask (Isaac, 21 October 2026). */
describe("a price", () => {
  it.each([
    ["can you give me a price for mitsubishi elec linear zone kit 4 bedrooms wireless sensors"],
    ["how much would it be to change to a linear zone kit"],
    ["what would it cost to add a zone"],
    ["have you got a rough idea for a 7kW split in the study"],
  ])("%j is a price now", (t) => expect(priceIntent(t)).toBe("price"));
  it.each([["I need to price up the quote for the Smiths"], ["remind me to price the ducting tomorrow"], ["send the quote for 3209 by Friday"]])(
    "%j is a task",
    (t) => expect(priceIntent(t)).toBe("task"),
  );
  it("asks when it could be either", () => {
    expect(priceIntent("I need to get a price for changing to a linear zone kit on this job")).toBe("either");
  });
  it("leaves anything without a price in it alone", () => {
    expect(priceIntent("Lyle has the head on the ute")).toBeNull();
  });
});
