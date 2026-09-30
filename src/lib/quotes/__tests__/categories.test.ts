/* The price book's shelves, on names from the business's real price files
   (2026-09-30): the narrow shelf wins over the wide one. */
import { categoryOf } from "../categories";

it.each([
  ["FUJITSU COMFORT R/C HWS IND 7.1KW", "ASTH24KNTA", "units"],
  ["MHI AVANTI HWS IND 2.5KW R/C INV WIFI", "DXK09ZSA-WF1", "units"],
  ["CARRIER AZURE 6.0KW HWS OUT", "X", "units"],
  ["PUMY-P125YKM", "PUMY-P125YKM4", "units"],
  ["Drain Socket PUMY-SP; PUZ-M; PUZ-ZM", "PAC-SH71DS-E", "drainage"],
  ["ME ACC WIRED CONTROLLER W/ BACKLIGHT", "PAR-41MAAM", "controls"],
  ["iZONE WIRELESS SENSOR - WHITE", "CRFSW", "controls"],
  ["PAIRED COIL 1/4+1/2X20M (6.35-12.7) 9mm (R.61/.52)", "PC1412", "pipe"],
  ['ARDENT ANN REF CU R410A 1/2" 12X0.81X18M (COIL)', "9800013-1", "pipe"],
  ['FIRE RATED INSULATION 15MMX 9MM WALL 2M (LEN)', "1-1", "pipe"],
  ['B-MAXIPRO ELBOW 1/2" X 90DEG (PKT3) (BAG)', "405957-1", "fittings"],
  ["CASTEL SOLENOID COIL 240VAC 9300/RA7 (EA)", "2712808-1", "refrigeration"],
  ["TEM 300MM 1PH FAN MOTOR ASSY 7552534 (EA)", "1-1", "refrigeration"],
  ["FASCO FAN MOTOR ACW 0.3A (EA)", "1-1", "parts"],
  ["WEATHERPROOF ISOLATOR 2 POLE 20 AMPS (EA)", "8028304-1", "electrical"],
  ["ASPEN MINI TANK CONDENSATE PUMP", "FP1056", "drainage"],
  ["REFCO R410A CH/HOSE SET CCL36-1/2 20UNF (EA)", "1-1", "consumables"],
  ["JET DIFFUSER MATT ABS 200", "CJ200", "grilles"],
  ["VORTEX FLEXIBLE DUCT R1.0 250mm - 10\"", "VB250", "ducting"],
  ["METAL BTO400.350.300 NSW", "X", "ducting"],
  ["BRIVIS STARPRO INT GDH 21KW 4*", "X", "heating"],
  ["GALVANISED METAL TRUNKING 2.4M (EA)", "1610380-1", "mounting"],
  ["NITTO DUCT TAPE BLACK 48mm x 30M", "BTAPE", "consumables"],
  ["PRIME R290 DISPOSABLE CYLINDER 400G (EA)", "1-1", "refrigerant"],
  ["ME ACC AIR OUTLET GUIDE PUZ-ZM71", "X", "accessories"],
  ["MILWAUKEE INKZALL COLOUR MARKERS 4 PACK (EA)", "1-1", "other"],
])("%s → %s", (name, code, shelf) => {
  expect(categoryOf(name, code)).toBe(shelf);
});
