#!/usr/bin/env python3
"""Save original NASA SSCWeb centered-dipole L / SM MLT / MLAT responses.

UTC dates: --start inclusive, --end exclusive. Python standard library only.
Each daily POST uses definitive rbspa/rbspb ephemerides at native cadence.
Raw response bytes, exact XML requests, provenance, and SHA-256 are retained.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

URL='https://sscweb.gsfc.nasa.gov/WS/sscr/2/locations'
FORMAT='van-allen-magnetic-manifest-v1'
def iso(t): return t.isoformat(timespec='seconds').replace('+00:00','Z')
def request_xml(start,end):
    body=f'<DataRequest xmlns="http://sscweb.gsfc.nasa.gov/schema"><TimeInterval><Start>{iso(start)}</Start><End>{iso(end)}</End></TimeInterval>'
    body+=''.join(f'<Satellites><Id>{p}</Id><ResolutionFactor>1</ResolutionFactor></Satellites>' for p in ['rbspa','rbspb'])
    body+='<OutputOptions><AllLocationFilters>true</AllLocationFilters>'
    body+=''.join(f'<CoordinateOptions><CoordinateSystem>Sm</CoordinateSystem><Component>{c}</Component></CoordinateOptions>' for c in ['Lat','Local_Time'])
    return body+'<ValueOptions><RadialDistance>true</RadialDistance><BFieldStrength>false</BFieldStrength><DipoleLValue>true</DipoleLValue><DipoleInvLat>false</DipoleInvLat></ValueOptions><MinMaxPoints>2</MinMaxPoints></OutputOptions></DataRequest>'
def unwrap(v):
    if isinstance(v,list):
        if len(v)==2 and isinstance(v[0],str) and v[0].startswith(('gov.nasa.','java.','javax.','[L','[D','[F')): return unwrap(v[1])
        return [unwrap(x) for x in v]
    if isinstance(v,dict): return {k:unwrap(x) for k,x in v.items()}
    return v
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start',required=True)
    parser.add_argument('--end',required=True)
    parser.add_argument('--refresh',action='store_true')
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'data'/'magnetic')
    args=parser.parse_args()
    try: start,end=[datetime.strptime(v,'%Y-%m-%d').replace(tzinfo=timezone.utc) for v in (args.start,args.end)]
    except ValueError: parser.error('Use UTC dates YYYY-MM-DD.')
    if not datetime(2012,8,30,tzinfo=timezone.utc)<=start<end<=datetime(2019,10,19,tzinfo=timezone.utc): parser.error('Select dates within the mission, ending no later than exclusive 2019-10-19.')
    args.output.mkdir(parents=True,exist_ok=True)
    path=args.output/'manifest.json'
    manifest=json.loads(path.read_text()) if path.exists() else {'format':FORMAT,'model':'SSCWeb centered dipole / Solar Magnetic (SM)','documentation':'https://sscweb.gsfc.nasa.gov/users_guide/Appendix_C.shtml','chunks':[]}
    if manifest.get('format')!=FORMAT: raise ValueError('Unsupported existing manifest.')
    while start<end:
        stop=start+timedelta(days=1)
        filename=f'ssc-magnetic-{start:%Y%m%d}.json'
        local=args.output/filename
        old=next((c for c in manifest['chunks'] if c['file']==filename),None)
        if old and local.exists() and not args.refresh and hashlib.sha256(local.read_bytes()).hexdigest()==old['sha256']:
            print('Reusing',filename);start=stop;continue
        body=request_xml(start,stop)
        with urlopen(Request(URL,data=body.encode(),headers={'Accept':'application/json','Content-Type':'application/xml','User-Agent':'VanAllenExplorer/1.2'}),timeout=60) as response: raw=response.read()
        result=unwrap(json.loads(raw)).get('Result',{})
        if result.get('StatusCode') not in ('SUCCESS','CONDITIONAL_SUCCESS'): raise ValueError(f"SSC retrieval failed: {result.get('StatusCode')} {result.get('StatusSubCode')}")
        request_file=filename.replace('.json','.xml')
        temporary=local.with_suffix('.part');temporary.write_bytes(raw);temporary.replace(local)
        (args.output/request_file).write_text(body,encoding='utf-8')
        chunk={'file':filename,'requestFile':request_file,'start':iso(start),'end':iso(stop),'url':URL,'method':'POST','retrievedAt':iso(datetime.now(timezone.utc)),'sha256':hashlib.sha256(raw).hexdigest(),'cadenceSeconds':60}
        manifest['chunks']=[c for c in manifest['chunks'] if c['file']!=filename]+[chunk]
        temp=path.with_suffix('.part');temp.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8',newline='\n');temp.replace(path)
        print('Saved',filename,len(raw),'bytes')
        start=stop
if __name__=='__main__': main()
