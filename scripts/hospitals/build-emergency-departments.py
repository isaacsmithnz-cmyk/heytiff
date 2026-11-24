"""THE EMERGENCY DEPARTMENTS, for the nearest one to a job (src/lib/hospitals).

Public hospitals with an emergency department, from two open data sets, both CC BY:
  - AIHW MyHospitals (https://myhospitalsapi.aihw.gov.au), Australian Institute of Health and Welfare:
      the hospitals, with where they are and whether they're private:
        /api/v1/reporting-units?reporting_unit_type_codes=H          -> ru.json
      the public hospitals that report emergency department presentations (data set 11186, 2024-25):
        /api/v1/datasets/11186/data-items                            -> ed.json
  - Geoscience Australia, National HealthDirect Health Facilities (CC BY 4.0), the emergency department services:
        https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer/1/query
        ?where=nhsd_service_type='Emergency department service'&outFields=*&outSR=4326&f=json   -> ga-ed.json

AIHW's list is every public ED that reports, but it misses most of Queensland's small ones; GA's has those, with no
public or private flag. So: every open public AIHW hospital in data set 11186; then each GA emergency department matched
to an AIHW hospital (within 1.5 km, or within 10 km by name), kept when that hospital is public and dropped when it is
private; a GA one near no AIHW hospital at all (a remote clinic) is kept as GA names it. A children's or women's
hospital, an eye and ear, dental, mental health or rehabilitation one is left out: it isn't where a worker is taken.

Run: python3 -I scripts/hospitals/build-emergency-departments.py <folder with the three files> > src/lib/hospitals/emergency-departments.json
"""
import json,sys,math
D=sys.argv[1]
ru=json.load(open(f'{D}/ru.json'))['result']
units={}
for r in ru:
    if not r['reporting_unit_code'].startswith('H'): continue
    st=next((m['mapped_reporting_unit']['reporting_unit_code'] for m in r.get('mapped_reporting_units',[]) if m['mapped_reporting_unit']['reporting_unit_type']['reporting_unit_type_code']=='S'),None)
    units[r['reporting_unit_code']]=dict(code=r['reporting_unit_code'],name=r['reporting_unit_name'],lat=r['latitude'],lng=r['longitude'],private=r['private'],closed=r['closed'],state=st)
ed=json.load(open(f'{D}/ed.json'))['result']
aihw=set(x['reporting_unit_summary']['reporting_unit_code'] for x in ed)
ga=json.load(open(f'{D}/ga-ed.json'))['features']
def km(a,b,c,d):
    R=6371;p=math.radians
    x=math.sin(p(c-a)/2)**2+math.cos(p(a))*math.cos(p(c))*math.sin(p(d-b)/2)**2
    return 2*R*math.asin(math.sqrt(x))
placed=[u for u in units.values() if u['lat'] is not None and not u['closed']]
out={}
for c in aihw:
    u=units.get(c)
    if u and u['lat'] is not None and not u['closed'] and not u['private']: out[c]=dict(u,src='aihw')
import re
def words(n): return set(w for w in re.findall(r"[a-z]+", n.lower()) if w not in {"hospital","health","service","services","the","and","of","campus","district","base","memorial","centre","center","private","public","multi","purpose"})
def sim(a,b):
    A,B=words(a),words(b)
    return len(A&B)/max(1,len(A|B))
def not_general(n):
    """Not where a worker is taken: a children's or women's hospital, eye and ear, dental, mental health, rehab."""
    l=n.lower()
    if re.search(r"eye and ear|dental|mental|psychiatr|rehab", l): return True
    if "children" in l: return True
    return "women" in l and " and " not in l and " & " not in l
dropped_private=[];unmatched=[];matched=0
for f in ga:
    a=f['attributes']
    if a.get('operationalstatus')!='active': continue
    near=[(km(a['latitude'],a['longitude'],u['lat'],u['lng']),u) for u in placed]
    cands=[(d,u) for d,u in near if d<=1.5 or (d<=10 and sim(a['organisation_name'],u['name'])>=0.5)]
    pub=[(d,u) for d,u in cands if not u['private']]
    if pub:
        d,best=max(pub,key=lambda x:(sim(a['organisation_name'],x[1]['name']),-x[0]))
        matched+=1
        out.setdefault(best['code'],dict(best,src='ga'))
    elif cands:
        dropped_private.append((a['organisation_name'],min(cands,key=lambda x:x[0])[1]['name']))
    else:
        unmatched.append((a['organisation_name'],a['state'],a['suburb']))
        if a['organisation_name'].strip().lower()!='queensland health':  # a GA row named for the department, not a place
            st={'NSW':'NSW','VIC':'Vic','QLD':'Qld','WA':'WA','SA':'SA','TAS':'Tas','NT':'NT','ACT':'ACT'}.get(a['state'],a['state'])
            out['GA:'+a['nhsd_service_id']]=dict(code='GA:'+a['nhsd_service_id'],name=a['organisation_name'],lat=a['latitude'],lng=a['longitude'],private=None,closed=False,state=st,src='ga-only')
out={k:v for k,v in out.items() if not not_general(v['name'])}
from collections import Counter
print(f"{len(out)} emergency departments, {len(dropped_private)} private left out, {len(unmatched)} GA-only:", dict(Counter(o['state'] for o in out.values())), file=sys.stderr)

def tidy(name):
    """The name a person says: no "(previously known as ...)", "(Public)" or a state added to tell two apart."""
    n = re.sub(r"\s+", " ", name)
    n = re.sub(r"\s*\((previously[^)]*|public)\)", "", n, flags=re.I)
    n = re.sub(r"\s+(NSW|Qld|Vic|SA|WA|Tas|NT|ACT)$", "", n)
    return n.strip()

rows = [
    {"name": tidy(o["name"]), "lat": round(o["lat"], 5), "lng": round(o["lng"], 5), "state": o["state"]}
    for o in sorted(out.values(), key=lambda o: (o["state"] or "", o["name"]))
]
print("[")
print(",\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
print("]")
