import pg from 'pg';

// Provenance is process-local and cannot be supplied by JWT/JSON. Each lease
// is associated with the exact pool that created it, not a database name or ID.
const origins = new WeakMap();
export function bindDatabaseAuthorityClient(client, pool) {
  const previous = origins.get(client);
  if (previous && previous !== pool) throw new Error('Database authority context changed.');
  origins.set(client,pool);
  return client;
}
export const databaseAuthorityPool = client => origins.get(client);

export class AuthorityBoundPool extends pg.Pool {
  constructor(config) { super(config);bindDatabaseAuthorityClient(this,this); }
  connect(callback) {
    if (callback !== undefined) return super.connect((error,client,release)=>{
      if (client) bindDatabaseAuthorityClient(client,this);
      callback(error,client,release);
    });
    return super.connect().then(client=>bindDatabaseAuthorityClient(client,this));
  }
}
