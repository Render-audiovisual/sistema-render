import unittest,sqlite3
import render_visit_material_monitor as m
class MonitorTests(unittest.TestCase):
 def test_links_in_comments_and_duplicate_ids(self):
  t={'comentarios':[{'contenido':'https://drive.google.com/drive/u/0/folders/abcdefghijk'}],'material_referencia':'https://drive.google.com/drive/folders/abcdefghijk'}
  self.assertEqual(m.folder_ids(t),['abcdefghijk'])
 def test_scan_all_task_pages(self):
  pages={0:{'tasks':[{'id':1}],'next_after':100},100:{'tasks':[{'id':101}],'next_after':None}}
  self.assertEqual(len(m.all_visits(pages.get)),2)
  with self.assertRaises(RuntimeError):m.all_visits(lambda _: {'tasks':[],'next_after':0})
 def test_nested_drive_and_pagination(self):
  def drive(method,path,params):
   if "'root'" in params['q']:return {'files':[{'id':'sub','name':'Reel','mimeType':m.FOLDER}]}
   if not params.get('pageToken'):return {'files':[{'id':'v1','name':'a','mimeType':'video/mp4'}],'nextPageToken':'next'}
   return {'files':[{'id':'v2','name':'b','mimeType':'video/mp4'}]}
  self.assertEqual(len(m.inventory(['root'],drive)),2)
 def test_modified_file_and_completion_trigger(self):
  t={'estado':'en_progreso'};f=[{'id':'a','modifiedTime':'1','name':'a'}]
  before=m.fingerprint(t,f);f[0]['modifiedTime']='2';self.assertNotEqual(before,m.fingerprint(t,f))
  after=m.fingerprint(t,f);t['estado']='en_revision';self.assertNotEqual(after,m.fingerprint(t,f))
 def test_deduplicate_and_preserve_uncertain(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE deliveries(id TEXT PRIMARY KEY,status TEXT)')
  sends=[]
  def sender(t):sends.append(t);return {'result':{'messageId':'ok'}}
  self.assertEqual(m.deliver(db,'one','text',sender),'sent');m.deliver(db,'one','text',sender);self.assertEqual(len(sends),1)
  with self.assertRaises(RuntimeError):m.deliver(db,'two','text',lambda _: {})
  self.assertEqual(m.deliver(db,'two','text',sender),'uncertain');self.assertEqual(len(sends),1)
 def test_proposal_does_not_claim_quality_or_duplicate_edits(self):
  t={'id':1754,'titulo':'EOS','ediciones_vinculadas':[{'id':99}]}
  f=[{'id':'v','mimeType':'video/mp4','folderId':'folder','folderPath':'folder/Reel'}]
  text=m.proposal(t,f);self.assertIn('no duplicar',text);self.assertIn('No evalué',text);self.assertIn('fecha de entrega',m.proposal({**t,'ediciones_vinculadas':[]},f))
if __name__=='__main__':unittest.main()
