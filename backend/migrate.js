const fs=require('fs');const path=require('path');const Database=require('better-sqlite3');
const dir='/data/db';fs.mkdirSync(dir,{recursive:true});
for(const [file,schema] of [['users.db','schema_users.sql'],['tags.db','schema_tags.sql']]){const db=new Database(path.join(dir,file));db.pragma('journal_mode=WAL');db.pragma('foreign_keys=ON');db.exec(fs.readFileSync(path.join(__dirname,'db',schema),'utf8'));db.close();}

// Additive migration: OAuth linkage columns on users.db, safe to re-run.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so each ALTER is attempted and a
// "duplicate column" failure (already migrated) is ignored; any other error
// still surfaces.
{
  const db=new Database(path.join(dir,'users.db'));
  for(const stmt of [
    "ALTER TABLE users ADD COLUMN oauth_provider TEXT",
    "ALTER TABLE users ADD COLUMN oauth_id TEXT"
  ]){
    try{ db.exec(stmt); }
    catch(e){ if(!/duplicate column/i.test(e.message)) throw e; }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id)");
  db.close();
}
