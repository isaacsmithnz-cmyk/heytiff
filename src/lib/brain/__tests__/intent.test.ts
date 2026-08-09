import { looksLikeQuestion } from "../intent";

/* The question/note split. The asymmetry these pin: a false "question" EATS
   A NOTE — the words go to the answer loop and nothing is saved — while a
   false "note" merely shows someone their own question on a review card,
   one Discard away. So every ambiguous case below must land on note. */

describe("things that are questions", () => {
  it.each([
    ["what's outstanding at Meridian"],
    ["whats left on the smith st job"],
    ["how many open tasks does Luke have"],
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
    // "tell Luke" is a task; only "tell me" asks
    ["tell Luke he needs to order the grilles"],
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
    ["cuántas tareas tiene Luke"],
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
    ["dile a Luke que pida las rejillas"],
  ])("%j records", (text) => {
    expect(looksLikeQuestion(text)).toBe(false);
  });
});
