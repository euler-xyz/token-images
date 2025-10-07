
import { SyncService } from './src/sync-service.ts';

try {
  console.log('Creating SyncService...');
  const service = new SyncService();
  console.log('SyncService created successfully');
} catch (error) {
  console.error('Error creating SyncService:', error.message);
  console.error(error.stack);
}

