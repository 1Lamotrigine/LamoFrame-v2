"""Read-only Django SQLite export; invoked by import-django.mjs."""
import json,sqlite3,sys
connection=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
connection.row_factory=sqlite3.Row
names=['builder_template','auth_user','builder_project','builder_asset','builder_datacollection','builder_collectionfield','builder_datarecord','builder_apppublication','builder_appmember','builder_appinvite','socialaccount_socialaccount']
result={}
existing={r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
for name in names:
 result[name]=[dict(row) for row in connection.execute('SELECT * FROM '+name)] if name in existing else []
print(json.dumps(result,ensure_ascii=False))
