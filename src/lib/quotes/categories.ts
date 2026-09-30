/* WHAT SHELF AN ITEM IS ON — the price book sorted so it can be browsed,
   not only searched.

   Worked out at read from the item's name (and, for Mitsubishi, its code),
   never stored: a better rule re-sorts every item without an import. The
   first category whose rule matches wins, so the narrow shelves come
   before the wide ones — a fan MOTOR is a spare part before it's a fan, a
   solenoid COIL is a spare part before it's pipe and coil. Pure. */

export type CategoryKey =
  | "units"
  | "controls"
  | "pipe"
  | "fittings"
  | "electrical"
  | "drainage"
  | "grilles"
  | "ducting"
  | "fans"
  | "mounting"
  | "refrigerant"
  | "parts"
  | "consumables"
  | "heating"
  | "refrigeration"
  | "filters"
  | "plumbing"
  | "accessories"
  | "other";

export const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "units", label: "Units" },
  { key: "controls", label: "Controls and zoning" },
  { key: "pipe", label: "Pipe and coil" },
  { key: "fittings", label: "Fittings and brazing" },
  { key: "electrical", label: "Electrical" },
  { key: "drainage", label: "Drainage" },
  { key: "grilles", label: "Grilles and diffusers" },
  { key: "ducting", label: "Ducting" },
  { key: "fans", label: "Fans and ventilation" },
  { key: "mounting", label: "Mounting and covering" },
  { key: "refrigerant", label: "Refrigerant and chemicals" },
  { key: "parts", label: "Spare parts" },
  { key: "accessories", label: "Unit accessories" },
  { key: "filters", label: "Filters" },
  { key: "plumbing", label: "Plumbing and PVC" },
  { key: "heating", label: "Heating and evaporative" },
  { key: "refrigeration", label: "Commercial refrigeration" },
  { key: "consumables", label: "Tools and consumables" },
  { key: "other", label: "Everything else" },
];

/* Mitsubishi's model ranges: the code says what it is when the trade
   book's words are brief */
const ME_UNIT = /^(MSZ|MUZ|MXZ|MFZ|MLZ|SEZ|SUZ|SLZ|PEA|PEAD|PEFY|PKA|PKFY|PLA|PLFY|PCA|PCFY|PMFY|PSA|PUZ|PUHZ|PUHY|PUMY|PURY|PQHY|PQRY|MVZ|PVA|PFFY|PFAV|LGH|GUF)-/i;
/* controllers, Wi-Fi interfaces and central controls; PAC-SH… are the
   outdoors' drain sockets and pans, not controls */
const ME_CONTROL = /^(PAR-|PAC-YT|PAC-SE|PAC-US|MAC-\d{3}IF|MAC-\d{3}RA|AT-|AE-|EW-|TC-|PZ-|CMS-|BAC-|LMAP)/i;

type Rule = { key: CategoryKey; test: (name: string, code: string) => boolean };
const words = (re: RegExp) => (name: string) => re.test(name);

const RULES: Rule[] = [
  /* Mitsubishi's ranges by code, before any word in a brief name */
  { key: "units", test: (_n, c) => ME_UNIT.test(c) },
  { key: "controls", test: (_n, c) => ME_CONTROL.test(c) },
  /* the words that settle it whatever else the name says: duct TAPE is
     tape, a drain SOCKET is drainage */
  { key: "consumables", test: words(/\btape\b|silicone|sealant/i) },
  { key: "drainage", test: words(/\bdrain\s*(socket|pan|pump|hose|tray)/i) },
  /* gas heating and evaporative coolers: their flues, droppers and pads
     are theirs, not ducting or mounting */
  {
    key: "heating",
    test: words(
      /\bBRIVIS\b|\bBRAEMAR\b|\bBRA\s|\bGDH\b|gas\s*(duct(ed)?\s*)?heater|\bflue\b|heat\s*shield|wall\s*furnace|\bPWF\b|evaporative|\bevap\s*cooler|\bcooler\b|coolair|\bcel\s*pad|dropper|\bcontour\b|\bRINNAI\b.*\b(GAS|HEATER)\b|\bBONAIRE\b.*\b(HEATER|COOLER)\b/i
    ),
  },
  /* commercial refrigeration: condensing units by horsepower, coolroom
     evaporators and their line components */
  {
    key: "refrigeration",
    test: words(
      /\bTEM\b|tecumseh|copeland|\bcope\b|\bC\/U\b|condensing\s*unit|\d\s*HP\b|\bcabero\b|coolroom|cool\s*room|freezer|\bdrier\b|sight\s*glass|\bcastel\b|\bcarel\b|danfoss|\bsecop\b|\bembraco\b|\bLPC\d|M\/TEMP|L\/TEMP|MED\s*TEMP|LOW\s*TEMP|evaporator/i
    ),
  },
  /* a unit by its words and its kW, before its Wi-Fi makes it a control */
  {
    key: "units",
    test: (n) =>
      /\b(HWS|HI\s*WALL|HIGH\s*WALL|WALL\s*MOUNTED\s*AC|SPLIT\s*SYSTEM|CASSETTE|DUCTED|UNDER\s*CEILING|CEILING\s*SUSPENDED|FLOOR\s*CONSOLE|CONSOLE)\b.*\d(\.\d+)?\s*KW|\b(IND|IDU|ODU|OUT|OUTDOOR|INDOOR)\b.*\d(\.\d+)?\s*KW|\d(\.\d+)?\s*KW.*\b(IND|IDU|ODU|OUT|OUTDOOR|INDOOR|INV|INVERTER|R\/C|R32|R410A?)\b|\bAC\s*SET\b|\bSET\s*\d(\.\d+)?\s*KW/i.test(n),
  },
  /* spare parts before anything they're a part OF */
  {
    key: "parts",
    test: words(
      /\bPCB\b|\bP\.C\.B|circuit\s*board|control\s*board|fan\s*motor|motor\s*(assy|assembly)|\bcapacitor\b|start\s*cap|\bMFD\b|compressor|thermistor|solenoid\s*coil|s\/noid\s*coil|\bcoil\s*(24|240)v|reversing\s*valve|4\s*way\s*valve|expansion\s*valve|\bLEV\b|\bEEV\b|\bTXV\b|fuse\b|transformer|bearing|fan\s*blade|blower\s*wheel|swing\s*motor|louvre\s*motor|vane\s*motor|pressure\s*(switch|control|sensor)|contactor|spare/i
    ),
  },
  {
    key: "controls",
    test: (n) =>
      /controller|thermostat|t\/stat|remote|wi-?fi\s*(adapt|interface|module)|interface|zone\s*(control|sensor|motor|module)|damper\s*motor|motori[sz]ed\s*damper|\bsensor\b|izone|airtouch|my\s*air|myplace|zoneiq|\bBMS\b|gateway|receiver|touch\s*screen|wall\s*control|wired\s*control|zone\s*box|wi-?fi|actuator|\bDRED\b|conversion\s*connector/i.test(n),
  },
  {
    key: "refrigerant",
    test: words(
      /\b(R32|R410A?|R22|R134A?|R407C|R404A|R290|R600A?)\b.*\b(GAS|CYL(INDER)?|KG|BOTTLE|REFRIGERANT)\b|\brefrigerant\s*(gas|R\d)|nitrogen|\boil\b|coil\s*clean|cleaner|\bbubble\b|leak\s*(detect|seal|stop)|flush|degreas|sanitis|disinfect|\bchemical\b|acid|treatment/i
    ),
  },
  {
    key: "pipe",
    test: words(
      /pair(ed)?\s*-?\s*coil|paircoil|\bPR\s+CU\b|\bANN(EALED)?\b.*\b(CU|COPPER|REF)\b|copper\s*(tube|pipe|coil)|\bREF\s*CU\b|hard\s*drawn|\bLWC\b|insulat(ion|ed)\s*(tube|pipe|sleeve)|armaflex|pipe\s*ins(ul)?\b|insulation\s+\d+\s*MM\s*X|\blagging\b|thermobreak\s*tube/i
    ),
  },
  {
    key: "fittings",
    test: words(
      /elbow|\btee\b|coupl|reducer|\bflare\b|bonnet|braz|solder|silfos|\bP\s*TRAP\b|\bunion\b|\bCOUP\b|refnet|y\s*joint|branch\s*pipe|flare\s*nut|\bbend\b|socket|\bsock\b|\bbush\b|stop\s*end|maxipro|b-press|\bcap\b|sweat|ball\s*valve|service\s*valve|schrader|access\s*(fitting|valve)|press\s*fit|zoomlock|\bjoiner\b|\bfitting/i
    ),
  },
  {
    key: "electrical",
    test: words(
      /isolator|\bcable\b|\bTPS\b|core\s*&?\s*earth|conduit|circuit\s*breaker|\bMCB\b|\bRCD\b|\bRCBO\b|\brelay\b|gland|junction\s*box|\bJ-?BOX\b|\bCAT\s*\d|power\s*point|\bGPO\b|\bplug\b|switch\b|\bwire\b|terminal/i
    ),
  },
  {
    key: "drainage",
    /* a charging hose set is a tool, not a drain */
    test: (n) => !/charg|CH\/HOSE|hose\s*set|manifold/i.test(n) && /drain|condensate|tundish|\bpump\b|\bP\s*trap|safe\s*tray|overflow|float\s*switch|\bhose\b/i.test(n),
  },
  {
    key: "grilles",
    test: words(/diffuser|\bDIFF\b|\bMDO\b|\d\s*WAY\b|grille|grill\b|register|\bREG\b|\bR\/A\b|\blouvre|louver|\bvent\b|jet\s*nozzle|eggcrate|linear\s*bar|slot\b|return\s*air|\bR\/AIR\b|filter\s*(box|grille)/i),
  },
  {
    key: "ducting",
    test: words(
      /duct\b|ducting|flex(ible)?\s*duct|\bflexi?\b|plenum|spigot|collar|take[-\s]?off|\bDBTO\b|\bY[-\s]?(piece|junction|branch)|\bboot\b|sheet\s*metal|damper|register\s*box|transition|hanging\s*strap|duct\s*(strap|clamp|tie)|\bbranch\b|airloc|smartfit|\bCUSH\b|head\s*box|\bBX\b.*\bINS\b|\bBTO|\bC\/BX\b|uniboot|spig+ot|\bVORTEX\b|\bN\/C\b|nose\s*cone|neck\s*adapt|range\s*adapt|\bS\/?A\s*ONLY\b|\bS\/A\b|roof\s*cowl|top\s*hat\s*roof/i
    ),
  },
  {
    key: "fans",
    test: words(/\bfan\b|exhaust|inline|in-line|ventilat|\bERV\b|\bHRV\b|heat\s*recovery|lossnay|\bEC\s*fan|jetflow|fresh\s*air/i),
  },
  {
    key: "mounting",
    test: words(
      /bracket|\bfeet\b|\bfoot\b|stand\b|trunking|pipe\s*cover|slim\s*duct|smart\s*duct|line\s*hide|duct\s*cover|strut|unistrut|rubber|vibration|anti-?vib|\bmount|hanger|support|clamp|channel|hat\s*section|isolation\s*spring|roof\s*(jack|stand)|wall\s*pass|cover\s*plate|flashing/i
    ),
  },
  {
    key: "consumables",
    test: words(
      /tape|silicone|sealant|screw|anchor|fixing|\bbolt|washer|cable\s*tie|zip\s*tie|\btie\b|glue|adhesive|foam|\bgauge|vacuum\s*pump|\btool\b|drill|\bbit\b|hole\s*saw|cutter|bender|bending|pliers|lifter|swag|flaring|manifold|\bhose\s*set|torch|nitrogen\s*reg|\bbag\b|gloves|rag|\bmask\b/i
    ),
  },
  /* the parts that go ON a unit: guides, deflectors, humidity kits */
  {
    key: "accessories",
    test: words(/\bACC\b|air\s*(outlet|protection|discharge)\s*guide|deflector|high\s*humidity|drain\s*(socket|pan)|\bguard\b|base\s*heater|snow\s*hood|panel\b|fascia/i),
  },
  { key: "filters", test: words(/filter/i) },
  { key: "plumbing", test: words(/\bPVC\b|\bPEX\b|\bpoly(pipe)?\b|\bvalve\b|\btap\b|\bBSP\b|\bcompression\b|\bbarb/i) },
  { key: "consumables", test: words(/\bnut\b|\bpad\b|\bpads\b/i) },
];

/** The shelf an item is on. */
export function categoryOf(name: string, code = ""): CategoryKey {
  for (const r of RULES) if (r.test(name, code)) return r.key;
  return "other";
}

export const categoryLabel = (key: CategoryKey) => CATEGORIES.find((c) => c.key === key)?.label ?? "Everything else";

export const isCategory = (v: unknown): v is CategoryKey => typeof v === "string" && CATEGORIES.some((c) => c.key === v);
