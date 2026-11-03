import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSaskatchewan } from '../scripts/load-cnfdb.mjs';

const HEADER = 'NFDBFIREID,SRC_AGENCY,NAT_PARK,FIRE_ID,FIRENAME,LATITUDE,LONGITUDE,YEAR,MONTH,DAY,REP_DATE,ATTK_DATE,OUT_DATE,SIZE_HA,CAUSE,CAUSE2,FIRE_TYPE,RESPONSE,PROTZONE,PRESCRIBED,MORE_INFO,CFS_NOTE1,CFS_NOTE2,ACQ_DATE';

test('extractSaskatchewan keeps SK wildfires and maps CNFDB fields', () => {
  const text = [
    HEADER,
    'SK-2025-25LF-SHOE,SK, ,25LF-SHOE, ,54.1,-104.9,2025,5,7,2025-05-07 0:00:00,,,592985.0,H,H,Wildfire, , , , , , ,2026-03-01 0:00:00',
    'SK-2015-15LR-EGG,SK, ,15LR-EGG,"Egg, Lake",55.2,-105.1,2015,6,27,,,,1200.5,N,N,Wildfire, , , , , , ,',
    'AB-2024-CWF-001,AB, ,CWF-001, ,50.06,-114.15,2024,1,2,2024-01-02 0:00:00,,,0.05,H,H,Wildfire, , , , , , ,',
    'SK-2020-RFA,SK, ,RFA, ,54,-105,2020,7,1,2020-07-01 0:00:00,,,10,U,U,Req For Assist, , , , , , ,',
    'SK-2019-BAD,SK, ,BAD, ,0,0,2019,7,1,2019-07-01 0:00:00,,,10,N,N,Wildfire, , , , , , ,',
  ].join('\n');
  const { fires, rejects, read } = extractSaskatchewan(text);
  assert.equal(read, 4);
  assert.equal(fires.length, 2);
  assert.deepEqual(rejects, { prescribed: 0, assistRequest: 1, badCoord: 1, badDate: 0 });
  assert.equal(fires[0].fire_id, 'SK-2025-25LF-SHOE');
  assert.equal(fires[0].ignition_date, '2025-05-07');
  assert.equal(fires[0].general_cause, 'Human');
  assert.equal(fires[1].general_cause, 'Lightning');
  assert.equal(fires[1].ignition_date, '2015-06-27'); // falls back to YEAR/MONTH/DAY
  assert.equal(fires[1].fire_name, 'Egg, Lake');      // quoted comma survives
});
