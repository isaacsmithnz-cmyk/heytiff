import Anthropic from "@anthropic-ai/sdk";

/* WHAT A FLEET VALUE IS ALLOWED TO CLAIM.

   This used to be one un-grounded call: Claude priced the fleet from training
   data alone and the register printed the number next to real book values, as
   if the two were the same kind of fact. They aren't. A model's sense of the
   used market is frozen at its cutoff, and used-vehicle prices move faster
   than that — the range it returned ($18,000–$42,000 on a $28,000 point) was
   the model saying so out loud.

   So the call now carries `web_search`: Claude prices each vehicle against
   live Australian listings and says in its note what it priced against. The
   number is still an estimate and still says "≈" on the screen, but it is an
   estimate with a market behind it rather than a memory.

   The `_20260209` variant runs its own filtering pass internally — do NOT also
   declare `code_execution` in `tools`, or the model gets two execution
   environments and gets confused about which one it is in. */

const MODEL = "claude-opus-4-8";

/** Bounded on purpose. Four vehicle families cover this fleet, and pricing a
    family takes a couple of searches — the model does NOT need one search per
    vehicle. This is also the main lever on how long the request runs. */
const MAX_SEARCHES = 12;

/* A server-tool turn runs its own sampling loop and stops with
   `stop_reason: "pause_turn"` when it hits the server's iteration cap. To
   resume you re-send the same messages with the paused assistant turn appended
   and nothing else — no "continue" message: the API sees the trailing
   server_tool_use block and picks up where it stopped. Capped so a search that
   never converges can't bill forever. */
const MAX_RESUMES = 4;

export type FleetAiVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  odometerKm: number;
  status: string; // "In service" | "Off road"
  purchasePriceAud: number | null;
  ageYears: number | null;
  notes?: string;
};

export type FleetValuation = { id: string; low: number; high: number; point: number; note: string };

export type ValueFleetResult =
  | { ok: true; valuations: FleetValuation[]; searched: boolean }
  | { ok: false; reason: string };

const VALUATION_SCHEMA = {
  type: "object",
  properties: {
    valuations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          low: { type: "integer" },
          high: { type: "integer" },
          point: { type: "integer" },
          note: { type: "string" },
        },
        required: ["id", "low", "high", "point", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["valuations"],
  additionalProperties: false,
};

export function valuationPrompt(vehicles: FleetAiVehicle[]): string {
  return (
    "You are Tiff, the AI inside HeyTiff, valuing a small Australian HVAC company's work " +
    "vehicles for their internal fleet register. All figures are AUD.\n\n" +
    "Search the live Australian used-vehicle market before you answer. These vehicles fall " +
    "into a handful of families, so establish the current asking range for each family from " +
    "real listings, then place each individual vehicle within its family's range on age, " +
    "odometer and condition. You do not need a separate search per vehicle.\n\n" +
    "For each vehicle, give a low–high range plus a single point estimate for what it would " +
    "fetch in a private sale today. Weigh age, odometer, the model's resale behaviour, and " +
    "typical tradie-fleet condition (fitted-out work vans/utes — serviced, but worked hard). " +
    'A status of "Off road" means a repairable fault: value it lightly discounted, not as a ' +
    "write-off. Round every figure to the nearest $100.\n\n" +
    "In each vehicle's note — at most 12 words — say what you priced it against, e.g. " +
    '"6 listings, 2019-21 Hiace LWB, 130-160k km". If a search returned nothing usable, ' +
    'say so in the note (e.g. "no live listings found — estimated from age and km") rather ' +
    "than implying a market check you did not make.\n\n" +
    `Return one valuation per vehicle, keyed by the same id.\n\nVehicles:\n${JSON.stringify(vehicles, null, 2)}`
  );
}

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff — check the connection.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an API error — try again.";
  return "Tiff couldn't complete that.";
}

/** True if any search actually returned results. A web-search block comes back
    HTTP 200 whether it worked or not — on success `content` is an ARRAY of
    results, on failure it's a single error OBJECT ({error_code: ...}). Branch
    on that shape, never on a thrown error, or a fleet priced entirely from
    memory reports itself as market-checked. */
export function anySearchSucceeded(content: Anthropic.ContentBlock[]): boolean {
  return content.some(
    (b) => b.type === "web_search_tool_result" && Array.isArray((b as { content?: unknown }).content),
  );
}

export async function runFleetValuation(
  vehicles: FleetAiVehicle[],
  client: Anthropic = new Anthropic(),
): Promise<ValueFleetResult> {
  if (vehicles.length === 0) return { ok: false, reason: "No vehicles to value." };

  const prompt = valuationPrompt(vehicles);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let searched = false;

  try {
    for (let attempt = 0; attempt <= MAX_RESUMES; attempt++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: VALUATION_SCHEMA },
        },
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_SEARCHES,
            user_location: { type: "approximate", country: "AU", timezone: "Australia/Sydney" },
          },
        ],
        messages,
      });

      if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff declined this request." };
      searched = searched || anySearchSucceeded(response.content);

      if (response.stop_reason === "pause_turn") {
        // Append the paused turn and go round again — nothing else is added.
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      const text = response.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(text) as { valuations?: FleetValuation[] };
      return { ok: true, valuations: parsed.valuations ?? [], searched };
    }
    return { ok: false, reason: "Tiff kept searching without finishing — try again." };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}
