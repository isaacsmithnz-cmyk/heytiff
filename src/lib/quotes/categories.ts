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
   book's words are brief. Lossnay (LGH) is ventilation, on Fans. */
const ME_UNIT = /^(MSZ|MUZ|MXZ|MFZ|MLZ|SEZ|SUZ|SLZ|PEA|PEAD|PEFY|PKA|PKFY|PLA|PLFY|PCA|PCFY|PMFY|PSA|PUZ|PUHZ|PUHY|PUMY|PURY|PQHY|PQRY|MVZ|PVA|PFFY|PFAV|MUFZ|MFXZ)-/i;
/* controllers, Wi-Fi interfaces and central controls; PAC-SH… are the
   outdoors' drain sockets and pans, not controls */
const ME_CONTROL = /^(PAR-|PAC-YT|PAC-SE|PAC-US|MAC-\d{3}IF|MAC-\d{3}RA|AT-|AE-|EW-|TC-|PZ-|CMS-|BAC-|LMAP)/i;

type Rule = { key: CategoryKey; test: (name: string, code: string) => boolean };
const words = (re: RegExp) => (name: string) => re.test(name);

/* Each rule was checked against the whole of a real book (7,272 items from
   eleven suppliers, 2026-10-05): what it moves, and what it must not. A
   comment says why a rule sits where it does when the order matters. */
const RULES: Rule[] = [
  /* Mitsubishi's ranges by code, before any word in a brief name */
  { key: "units", test: (_n, c) => ME_UNIT.test(c) },
  /* a cassette's panel or grille is an accessory, whatever its name says
     ("Grille with Receiver and Remote Controller"), and every fascia is one */
  { key: "accessories", test: (n, c) => /^(MLP|SLP|PLP)-/i.test(c) || /\bfa(s)?cia\b/i.test(n) },
  { key: "controls", test: (_n, c) => ME_CONTROL.test(c) },
  /* the words that settle it whatever else the name says: duct TAPE is
     tape, a drain SOCKET is drainage, a tube BENDER is a tool, a TORCH is a
     torch even when it finds leaks */
  {
    key: "consumables",
    test: words(
      /\btape\b|silicone|sealant|adhesive|torch|\banchors?\b|wall\s*plugs?|cutter|flaring\s*tool|nitro(gen)?\s*reg|(gas|refrig\w*)\s*leak\s*detector|leak\s*detector\s*[A-Z]{2}\d|injection\s*hose|bender|bending|tube\s*cut|fin\s*comb|debur|wrench/i
    ),
  },
  { key: "drainage", test: words(/\bdrain\s*(socket|pan|pump|hose|tray|plug|kit)|evaporation\s*tray/i) },
  /* a water hose is plumbing before any hose is drainage or any flexi is ducting */
  { key: "plumbing", test: words(/water\s*hose|hose\s*wat(er)?\b|flex(ible)?\s*(connecting\s*)?hose/i) },
  /* gas heating and evaporative coolers, whole brand: their flues,
     droppers, pads and spigots are theirs, not ducting or mounting — but a
     Braemar split is a unit, and a Braemar nose cone or box is ducting */
  {
    key: "heating",
    test: words(
      /\bBRIVIS\b|\bBRAEMAR\b(?!.*\bHWS\b)|\bBRA\s(?![NSR]\/[CA]\b)|\bGDH\b|gas\s*(duct(ed)?\s*)?heater|\bflue\b|heat\s*shield|wall\s*furnace|\bPWF\b|evaporative|\bevap\s*cooler|coolair|\b(cel|filtex)\s*pad|dropper|\bcontour\b|\bRINNAI\b.*\b(GAS|HEATER)\b|\bBON(AIRE)?\b|\bBREEZAIR\b|\bSEELEY\b|\bicebox\b|\bcowl\s*gas\b/i
    ),
  },
  /* commercial refrigeration: condensing units by horsepower, coolroom
     evaporators and their line components, coolroom doors and their hardware */
  {
    key: "refrigeration",
    test: words(
      /\bTEM\b|tecumseh|copeland|\bcope\b|\bC\/U\b|condensing\s*unit|\d\s*HP\b|\bcabero\b|coolroom|cool\s*room|cold\s*room|coolrm|freezer|\bdrier\b|sight\s*glass|\bcastel\b|\bcarel\b|danfoss|\bsecop\b|\bembraco\b|\bLPC\d|M\/TEMP|L\/TEMP|MED\s*TEMP|LOW\s*TEMP|evaporator(?!\s*clean)|capillary\s*tube\s*sp|copper\s*capillary|\bF\/LINE\b|\b\d+G\s*DR\b|\bCRH\b|\bkason\b|door\s*guide|guide\s*roller|eccentric\s*wheel|two\s*finger\s*gasket/i
    ),
  },
  /* a unit by its words and its kW, before its Wi-Fi makes it a control */
  {
    key: "units",
    test: (n) =>
      /\b(HWS|WHS|WINDOW|HI\s*WALL|HIGH\s*WALL|WALL\s*(MOUNTED\s*)?AC|SPLIT\s*SYSTEM|CASSETTE|DUCTED|UNDER\s*CEILING|CEILING\s*SUSPENDED|FLOOR\s*CONSOLE|CONSOLE)\b.*\d(\.\d+)?\s*KW|\b(IND|IDU|ODU|OUT|OUTDOOR|INDOOR)\b.*\d(\.\d+)?\s*KW|\d(\.\d+)?\s*KW.*\b(IND|IDU|ODU|OUT|OUTDOOR|INDOOR|INV|INVERTER|R\/C|R32|R410A?)\b|\bAC\s*SET\b|\bSET\s*\d(\.\d+)?\s*KW|water\s*heater|dehumidifier|reverse\s*cycle/i.test(n),
  },
  /* switchgear on a DIN rail is electrical before a contactor or fuse is a spare part */
  { key: "electrical", test: words(/\bDIN\b|\bHRC\b|fu\s?se\s*holder|door\s*chime/i) },
  /* spare parts before anything they're a part OF ("10MFD" is a run
     capacitor; "TRANSPARENT" is not a spare) */
  {
    key: "parts",
    test: words(
      /\bPCB\b|\bP\.C\.B|circuit\s*board|control\s*board|fan\s*motor|motor\s*(assy|assembly|pulley|protector)|\bEBM\b|\bmotor\s+\d{3}V\b|\bspeed\s*motor\b|\bvee\s*belts?\b|thermal\s*overload|crankcase|\bIN\s*\d+\s*KPA|\b24\s*VAC\s*COIL\b|\bcapacitor\b|start\s*(cap|relay)|MFD\b|compressor|thermistor|solenoid\s*coil|s\/noid\s*coil|\bcoil\s*(24|240)v|rev(ers(e|ing))?\s*valve|4\s*way\s*valve|expansion\s*valve|\bLEV\b|\bEEV\b|\bTXV\b|fuse\b|transformer|bearing|fan\s*blade|\bblower\b|swing\s*motor|louvre\s*motor|vane\s*motor|pressure\s*(differential\s*)?(switch|control|sensor)|\bP\/SWITCH|flow\s*switch|\bF\/SWITCH|contactor|\bspares?\b/i
    ),
  },
  {
    key: "controls",
    test: (n) =>
      /controller|thermostat|t\/stat|remote|wi-?fi\s*(adapt|interface|module)|interface|zone\s*(control|sensor|motor|module|relay|barrel)|damper\b.*\bmotor|\bmotor\b.*\bdamper|motori[sz]ed\b.*\bdamper|\bMTR\s*DAMP|zone\s*damper|sonic\s*drive|\bsens(o)?r\b|izone|airtouch|my\s*air|myplace|myzone|\d\s*zone\b|zoneiq|\bBMS\b|gateway|receiver|touch\s*(screen|pad|control)|selector\s*pad|speed\s*control|wall\s*control|wire(d|less)\b.*\bcont(rol)?\b|\bext\s*(control|connect)|\bcomm\s*kit|wiring\s*(kit|adaptor|loom)|demand\s*adapt|\bADP\s+EXT\b|install(ation)?\s*box|m-?net|run\/fault|hvac\s*ctrl|temperature\s*control|defrost\s*module|cycle\s*timer|delay\s*on\s*(make|break)|\bhoneywell\b|frigbot|zone\s*box|wi-?fi|actuator|\bDRED\b|conversion\s*connector/i.test(n),
  },
  /* refrigerant, gases and the chemicals of the trade; "flush" alone would
     take every flush-mount switch and GPO */
  {
    key: "refrigerant",
    test: words(
      /\b(R32|R410A?|R22|R134A?|R407C|R404A|R290|R600A?)\b.*\b(GAS|CYL(INDER)?|KG|BOTTLE|REFRIGERANT)\b|\brefrigerant\s*(gas|R\d)|nitrogen\s*(dry|gas|cyl)|\boil\b|lubricant|glycol|coil\s*(clean|coat|cure)|foam-?a-?coil|clean(e)?r\b|cleaning\s*solution|ice\s*mac\s*clean|protect\s*coating|\bbubble\b|leak(age)?\s*(det\w*|find|seal|stop|fr(ee)?z\w*|flash)|\bUV\s*dye|\bdye\b|super\s*seal|easy\s*dose|\breclaim\b|flush(ing)?\s*(agent|kit)|pump\s*down|sponge\s*gel|degreas|sanitis|disinfect|anti\s*bacterial|\bmould\b|odou?r\s*(block|n\/liser)|deodou?ris|clen-?air\s*citrus|essence|reactive\s*gel|sanifresh|clean\s*air\s*home|\bchemical\b|acid|treatment/i
    ),
  },
  {
    key: "pipe",
    test: words(
      /pair(ed)?\s*-?\s*(coil|cop)|paircoil|\bPR\s+CU\b|\bARDENT\s+FR\b|\bANN(EALED)?\b.*\b(CU|COPPER|REF)\b|copper\s*(tube|pipe|coil)(?!\s*clip)|\bREF\s*CU\b|\bHD\s+(REFRIG\s+)?CU\b|\bCUHD\b|hard\s*drawn|\b[HS]-DRAWN\b|\bTALOS\b|\bLWC\b|insulat(ion|ed)\s*(tube|pipe|sleeve)|armaflex|pipe\s*ins(ul)?\b|insulation\s+\d+\s*MM\s*X|\blagging\b|thermobreak\s*tube/i
    ),
  },
  /* split-system pipe covers and their caps, and strut: mounting, before a
     cover's "duct" makes it ducting or its "cap" a fitting */
  {
    key: "mounting",
    test: words(
      /trunk(ing)?\b|\bCB\s*CAP\b|pipe\s*cover|line\s*hide|duct\s*cover|\basuka\b|aussie\s*duct|pacific\s*(pipe\s*)?duct|wall\s*hung\s*duct|smart\s*duct(?!\s*drain)|strut|rod\s*couplers?|hex\s*coupler|condenser\s*feet|angle\s*fitting/i
    ),
  },
  /* duct reducers and joiners (a metal one, or one 120 mm and up) are
     ducting before a copper reducer is a fitting; wiring duct is electrical */
  {
    key: "ducting",
    test: words(
      /\bduct(ing)?\b(?!\s*&\s*lid)|\bdeflecto\b|\bmetal\b.*\b(reducer|joiner)\b|\b(reducer|joiner)\b.*\bmetal\b|\b(reducer|joiner)\b.*\b(1[2-9]\d|[2-9]\d\d)(\s*mm)?\b|\b(1[2-9]\d|[2-9]\d\d)(\s*mm)?\b.*\b(reducer|joiner)\b/i
    ),
  },
  /* conduit and its fittings, sockets with an amp rating, TV and data: electrical before a fitting */
  {
    key: "electrical",
    test: words(/conduit|\bPVC\s*(grey|orange)|\bgrey\s*\d+\s*mm\b|\bHD\s*grey\b|\bGPO\b|power\s*point|socket\b.*\b\d+\s*A\b|\bTV\b|cable\s*tray|\bRJ\s*\d+|mount(ing)?\s*box/i),
  },
  /* PVC, DWV and compression water fittings are plumbing before an elbow is a fitting */
  {
    key: "plumbing",
    test: words(/\b(U?PVC|DWV)\b.*\b(elbow|elb|tee|bend|socket|skt|coupling|bush|union|cap|junction|taper|reducer)\b|\bcompression\s*(\w+\s*)?(union|elbow|tee)\b/i),
  },
  {
    key: "fittings",
    test: words(
      /elbow|\belb\b|\btee\b|coupl|reducer|\bflare\b|bonnet|braz|solder|silfos|\bP\s*TRAP\b|\bunion\b|\bCOUP\b|refnet|y\s*joint|branch\s*pipe|fl(are)?\s*nut|seal\s*plug|\btaper\b|\bbend\b|socket(?!\s*(outlet|polarity))|\bsock\b|\bSKT\b|\bbush\b|stop\s*end|b-press|\bcap\b|sweat|ball\s*valve|service\s*valve|schrader|access\s*(fitting|valve)|rotalock|cu\s*tail|refrigerant\s*valve|press[\s-]*fit|zoomlock|\bjoiner\b|\bfitting|nipple|pierce\s*valv|\bcyl\s*ad(a?pt?)?\b/i
    ),
  },
  /* electrical: a fan's speed switch is the fan's */
  {
    key: "electrical",
    test: (n) =>
      !/\bspeed\s*switch\b/i.test(n) &&
      /isolator|\bcable\b(?!\s*ties?\b)|\bTPS\b|core\s*&?\s*earth|\d\s*core\b|flat\s*twin|twin\s*(and\s*|&\s*)?earth|\b\d\s*C\s*\+\s*E\b|per\s*metre|mm2\b|screened|shielded|\bcoax|\bfig\s*8|conduit|circuit\s*breaker|\bMCB\b|\bRCD\b|\bRCBO\b|\brelay\b|\bgland|ju?n?ction\s*(box|bx)|junc\s*box|\bJ-?\s?BOX\b|kn\s?ockout|adapt\w*\s*(square\s*)?box|\bCAT\s*\d|power\s*point|power\s*outlet|\bGPO\b|\bplug\b|switch\b|switchboard|\bwire\b|terminal|\bterm\b|screw\s*connector|insulated\s*connector|\d\s*A\s*connector|connector\s*\d\s*(port|wir)|crimp|forked\s*spade|busbar|neutral\s*link|pole\s*filler|\bencl\b|enclosure|load\s*cent(re|er)|\bDIN\b|\b1G\b|behind\s*plaster|plaster\s*brackets|\bWPROOF\b|ext(ension)?\s*(lead|cord)|smoke\s*alarm|\bLED\b|dimmer|down\s*light|\bD\/\s?L(ight)?\b|batten|\bGU10\b|ceiling\s*rose|bullnose|\bPIR\b|intercom|antenna|access\s*point|earth\s*rod|heat\s*shrink|timer\s*(clock|24\s*HR)|variable\s*speed\s*drive|duct\s*&\s*lid|cable\s*clip/i.test(n),
  },
  {
    key: "drainage",
    /* a charging or vacuum hose is a tool, not a drain */
    test: (n) =>
      !/charg|CH\/HOSE|hose\s*(set|seal|gasket|adapt)|seal\s*hose|injection\s*hose|\bvac(uum)?\b|manifold/i.test(n) &&
      /drain|condensate|tundish|\bpump\b|\btrap\b|\btray\b|overflow|float\s*switch|\bhose\b|rubber\s*adaptor|mini\s*aqua|\bCNDS\/P\b/i.test(n),
  },
  {
    key: "grilles",
    test: words(
      /diffuser|\bDIFF\b|\bMDO\b|airchute|grille|double\s*deflection|register|\b(FLR|WALL)\W?REG\b|\bR\/A\b|\bRA\s+(BOX|\d)|\blouvre|louver|(eave|direct)\s*vent\b|jet\s*nozzle|eggcrat|egg\s*crate|\blinear\b|return\s*air|\bR\/AIR\b|filter\s*(box|grille)/i
    ),
  },
  {
    key: "ducting",
    test: words(
      /duct\b|\bducting\b|flex(ible)?\s*duct|\bflexi?\b|plenum|spigot|start(er|ing)?\s*(collar|plate)|take[-\s]?off|\bDBTO|\bY[-\s]?(piece|junction|branch)|\bY\s+(PLAIN\s+|COMBO\s+)?\d{3}[.\-]|\bboot\b|sheet\s*metal|damper|register\s*box|transition|hanging\s*strap|duct\s*(strap|clamp|tie)|airloc|smartfit|\bCUSH(ION)?\b|head\s*box|\bBX\b.*\bINS\b|\bBTO|\bC\/BX\b|uniboot|spig+ot|\bVORTEX\b.*\bR\d|(\b|KW)N\/C\s*(STD\s+|PRM\s+)?\d|\bNC\s+\d|nose\s*cone|neck\s*adapt?|(mvent|\bMDR)\s*ad(a?pt?)|range\s*adapt|\bS\/?A\b(?!\s*ONLY)|SQ-RND|(roof|metal)\s*cowl|cowl\s*hat|roof\s*vent|nude\s*core|v-?\s?box\b|canvas\s*connector|attenuator|volume\s*control|hushflex|D\/WRAP|swirl\s*box|snap\s*on\s*box/i
    ),
  },
  {
    key: "fans",
    test: words(/\bfan\b|exhaust|inline|in-line|ventilat|\bERV\b|\bHRV\b|heat\s*recovery|lossnay|\bEC\s*fan|jetflow|air\s*curtain|\baxial\b|jetline|powerline|roof\s*unit/i),
  },
  {
    key: "mounting",
    test: words(
      /bracket|\bbrack\b|\bbrkt\b|\bfeet\b|\bfoot\b|stand\b|trunking|pipe\s*cover|slim\s*duct|smart\s*duct|line\s*hide|duct\s*cover|strut|unistrut|\bchan\b|rubber|vibration|anti-?vib|waffle|bolted\s*(clip|sleeve)|\bmount(s|ed|ing)?\b|hanger|hanging\s*kit|support|clamp(?!\s*-?meter)|channel|hat\s*section|isolation\s*spring|roof\s*(jack|stand)|wall\s*pass|cover\s*plate|flash(ing)?\b|pipe\s*clip|dektite|\bdek\b|superboot|roof\s*(kit|seal)|versatile|threaded\s*rod|all\s*thread|studding|\bslab\b|polyslab|hoop\s*iron|(gal|perforated)\s*strap|slotted\s*angle|lintel|purlin|cleat|walraven|griplock|turnbuckle|pipe\s*lounge|thermaloc|chipboard\s*\d|\bhngr\b/i
    ),
  },
  {
    key: "consumables",
    test: words(
      /tape|silicone|sealant|screw|anchor|fixing|\bbolt|washer|cable\s*tie|zip\s*tie|\btie\b|glue|adhesive|foam|\bgauge|vac(uum)?\s*(pump|hose)|hose\s*(seal|gasket|adapt)|seal\s*hose|injection\s*hose|access\s*(control|ctrl)\s*valve|\bC\/LINE\b|\bQ\/C\s*auto|\btool\b|drill|\bbit\b|hole\s*saw|cutter|bender|bending|plier|lifter|swag|flaring|manifold|\bhose\s*set|torch|nitro(gen)?\s*reg|\bbags?\b|glove|rag|\bmask\b|meter\b|\bjaws?\b|press\s*ring|abrasive|needle\s*p(oin)?t|\bSDS\b|hammer\s*drive|expandit|wall\s*dog|toggle|\bCL4\b|metal\s*thread|\bscales?\b|recovery\s*unit|airvac|charg|\bhoses\b|m\/?fold|wrench|hex\s*key|snips|\bsaw\b|knife|shears|cutting|tube\s*cut|debur|expander|core\s*remov|\bT\/B\b|easybend|thermometer|anemometer|\btherm\b|tester|volt(age)?\s*(alert|detec)|test\s*lead|\bDMM\b|\bL\/DETR?\b|inspection\s*(mirror|light)|lumens|batter(y|ies)|respirator|fusions|safestyle|wipes|brush|sprayer|spray\s*bottle|spray\s*paint|marker|\bgun\b|fin\s*comb|magnet|lighter|oxygen|acetylene|\bmapp?\b|butane|trace-?a?-?gas|\bcyl(inder)?\b|D\/PORT|paste|compound|cool\s*gel|[FM]SAE\b|appion|rothenberger|rola|tie\s*down|arbou?r|push\s*pull\s*rod|\baerosol\b|hydro(cell|bag)|oiler|\bdriver\b|\bO\s*RINGS?\b|sealer|mastic|gap\s*seal|ductseal/i
    ),
  },
  /* a filter is a filter before it's a unit's accessory, but an auto
     filter-elevation panel is the unit's */
  { key: "filters", test: words(/filter(?!\s*elevation)|pocket|\bpleat|\bmedia\b|cartridge/i) },
  /* the parts that go ON a unit: guides, deflectors, humidity kits, fresh-air kits, cages */
  {
    key: "accessories",
    test: words(/\bACC\b|air\s*(outlet|protection|discharge)\s*guide|deflector|high\s*humidity|drain\s*(socket|pan)|\bguard\b|base\s*heater|snow\s*hood|panel\b|fa(s)?cia|shutter\s*plate|\bcage\b|fresh\s*air\s*(intake|kit)/i),
  },
  { key: "plumbing", test: words(/\bPVC\b|\bPEX\b|\bpoly(pipe)?\b|\bvalve\b|\btap\b|\bBSP\b|\bcompression\b|\bbarb|\bSWV\b|solvent|priming|\bDWV\b|\bolive\b|\bcock\b|\bfloat\b/i) },
  { key: "consumables", test: words(/\bnuts?\b|\bpad\b|\bpads\b/i) },
  /* a metal saddle holds a pipe up; a PVC saddle clip stayed on plumbing above */
  { key: "mounting", test: words(/\bsaddl/i) },
  /* Mitsubishi's accessory ranges, last, so its controls and drain sockets win first */
  { key: "accessories", test: (_n, c) => /^(PAC|MAC)-/i.test(c) },
];

/** The shelf an item is on. */
export function categoryOf(name: string, code = ""): CategoryKey {
  for (const r of RULES) if (r.test(name, code)) return r.key;
  return "other";
}

export const categoryLabel = (key: CategoryKey) => CATEGORIES.find((c) => c.key === key)?.label ?? "Everything else";

export const isCategory = (v: unknown): v is CategoryKey => typeof v === "string" && CATEGORIES.some((c) => c.key === v);
