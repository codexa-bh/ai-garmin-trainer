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
            run=SimpleNamespace(root=root,database=root/'trainer.sqlite',binary=root/'owned-test-binary',child=None,descriptor={'historySetup':'use-existing'})
            settings.prepare_settings(run)
            value=json.loads((root/'config/settings-v3.json').read_text())
            self.assertEqual(value['keys'],{})
            self.assertEqual(value['chatCatalog'],settings.SUMMARY_CATALOG)
            self.assertEqual(value['fields']['SUMMARY_ENABLED'],'false')
            self.assertEqual(value['fields']['SUMMARY_MODEL'],'unselected')
            self.assertTrue(run.keyless_lifecycle)
            self.assertEqual(len(settings.preserved_fields(run)),19)
            for key,value in settings.preserved_fields(run).items():self.assertEqual(value,json.loads((root/'config/settings-v3.json').read_text())['fields'][key])
            for descriptor in [{},{'historySetup':'create-new'},{'historySetup':'use-existing','providerSmoke':'t0270-summary-luna-100'}]:
                run.descriptor=descriptor
                with self.assertRaises(ValueError):settings.prepare_settings(run)

    def test_saved_fields_refuse_hidden_path_legacy_key_or_history_scope_loss(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();(root/'config').mkdir(mode=0o700)
            run=SimpleNamespace(root=root,binary=root/'owned-test-binary')
            fields={**settings.preserved_fields(run),'SUMMARY_ENABLED':'true','SUMMARY_MODEL':settings.SUMMARY_CHOICE,'SUMMARY_CHAR_LIMIT':'6000','GARMIN_HISTORY_START_DATE':'2024-01-01'}
            value={'keys':{},'fields':fields}
            path=root/'config/settings-v3.json'
            settings.private_json(path,value)
            settings.verify_saved(run,True)
            for key in settings.preserved_fields(run):
                altered={**value,'fields':{**fields,key:'unexpected'}}
                path.write_text(json.dumps(altered))
                with self.assertRaises(ValueError):settings.verify_saved(run,True)
            for altered in [{**value,'keys':{'OPENAI_API_KEY':'not-authorized'}},{**value,'fields':{**fields,'GARMIN_HISTORY_START_DATE':''}}]:
                path.write_text(json.dumps(altered))
                with self.assertRaises(ValueError):settings.verify_saved(run,True)

    def test_capture_actions_are_finite_and_carry_surface_state_without_arbitrary_input(self):
        calls=[]
        run=SimpleNamespace(settings_action=lambda action:calls.append(action) or {'ok':True})
        self.assertEqual(len(settings.captures(run,'On')),2)
        self.assertEqual(len(settings.captures(run,'Off',history=True)),2)
        self.assertEqual(calls,['captureSummaryWide','captureSummaryNarrow','captureHistoryWide','captureHistoryNarrow'])

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
