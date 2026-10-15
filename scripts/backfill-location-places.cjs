// Run inside the API container after deployment. Dry run unless --apply is given.
// Never alter Stephen's account or overwrite an existing Google destination.
const {db}=require('/app/dist/db/connection');
const {resolveLocationPlace}=require('/app/dist/services/location-place');
(async()=>{
 const apply=process.argv.includes('--apply');
 const rows=await db('active_locations as locations').join('clients','clients.id','locations.client_id').join('users','users.id','clients.user_id')
  .whereNull('locations.google_place_id').whereNot('clients.id','c8a1885e-4d9b-40cf-8378-b6287472c788').whereNot('users.email','stephen@legacyfitnesssolutions.com')
  .whereNotNull('locations.address').whereNotNull('locations.city').whereNotNull('locations.state').select('locations.id');
 let matched=0;for(const row of rows){if(apply&&await resolveLocationPlace(row.id))matched++;}
 console.log(JSON.stringify({apply,eligible:rows.length,matched,needsManualConfirmation:apply?rows.length-matched:null,stephen:'excluded'}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.destroy());
