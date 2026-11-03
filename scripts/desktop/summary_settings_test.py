import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import summary_settings as settings


class SummarySettingsTests(unittest.TestCase):
    def test_only_stopped_keyless_existing_scope_prepares_fixed_off_defaults(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();(root/'config').mkdir()
            run=SimpleNamespace(root=root,database=root/'trainer.sqlite',child=None,descriptor={'historySetup':'use-existing'})
            settings.prepare_settings(run)
            value=json.loads((root/'config/settings-v3.json').read_text())
            self.assertEqual(value['keys'],{})
            self.assertEqual(value['chatCatalog']['entries'],[])
            self.assertEqual(value['fields']['SUMMARY_ENABLED'],'false')
            self.assertEqual(value['fields']['SUMMARY_MODEL'],'unselected')
            self.assertTrue(run.keyless_lifecycle)
            for descriptor in [{},{'historySetup':'create-new'},{'historySetup':'use-existing','providerSmoke':'t0270-summary-luna-100'}]:
                run.descriptor=descriptor
                with self.assertRaises(ValueError):settings.prepare_settings(run)

    def test_native_unselected_projects_to_empty_api_model_without_accepting_enabled_or_pending_state(self):
        value={'enabled':False,'model':'','state':'disabled','pending':0,'items':0}
        self.assertTrue(settings.default_summary(value))
        for wrong in [{**value,'enabled':True},{**value,'model':'gpt-6-luna'},{**value,'pending':1},{**value,'items':1}]:
            self.assertFalse(settings.default_summary(wrong))

    def test_settings_only_metadata_refuses_sources_and_attempts_before_any_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder).resolve()/'trainer.sqlite'
            db=sqlite3.connect(path)
            db.executescript('create table conversation_completion(id integer);create table summary_attempt(id integer);');db.close()
            run=SimpleNamespace(database=path)
            with patch.object(settings,'api',return_value=(200,{'enabled':False})):
                self.assertEqual(settings.metadata(run),{'enabled':False})
                db=sqlite3.connect(path);db.execute('insert into summary_attempt values(1)');db.commit();db.close()
                with self.assertRaises(ValueError):settings.metadata(run)
