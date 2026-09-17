import { bootstrap } from '../bootstrap';
import { log } from '../env';

const { database } = await bootstrap();
log.info('Migrationer kørt og kilderegister synkroniseret');
await database.close();
