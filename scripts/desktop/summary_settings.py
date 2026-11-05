#!/usr/bin/env python3
"""Finite keyless ordinary native summary form Save/load/restart evidence."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import signal
import uuid
import smoke_resources as resources
from native_smoke import Observer, canonical, fingerprint, private_json, readonly, source_identity
from ordinary_smoke import audit, private_directory
from history_smoke import HistoryRun
from smoke_input import prepare, json_document
from summary_live import api


SUMMARY_ENTRY = {'id':'entry_summary_local','provider':'ollama','modelId':'synthetic-memory:small'}
SUMMARY_CATALOG = {'version':1,'entries':[SUMMARY_ENTRY,
    {'id':'entry_summary_cloud','provider':'openai','modelId':'gpt-6-luna'},
    {'id':'entry_summary_other','provider':'ollama','modelId':'synthetic-chat:large'}], 'defaultEntryId':None}
CLOUD_CHOICE = json.dumps({'version':1,'entryId':'entry_summary_cloud','provider':'openai','modelId':'gpt-6-luna'}, separators=(',',':'))
SUMMARY_CHOICE = json.dumps({'version':1,'entryId':SUMMARY_ENTRY['id'],'provider':SUMMARY_ENTRY['provider'],'modelId':SUMMARY_ENTRY['modelId']}, separators=(',',':'))


def preserved_fields(run):
    inventory=json.loads((Path(__file__).resolve().parents[2]/'src-tauri/ui/settings-fields.json').read_text())
    values={field['key']:field.get('default',field.get('options',[''])[0]) for field in inventory
            if field.get('legacy') or field['key'].endswith('_COMMAND')}
    # A real canonical existing run-owned file exercises exact custom path round
    # trips; this keyless scenario never invokes connector/FIT tools.
    values.update({field['key']:str(run.binary.resolve()) for field in inventory if field['key'].endswith('_COMMAND')})
    values.update({'AI_PROVIDER':'ollama','AI_MODEL':'synthetic-preserved-openai','DEEPSEEK_MODEL':'synthetic-preserved-deepseek',
                   'MEMORY_EMBEDDING_DIMS':'768','MEMORY_TIMEOUT_MS':'15432','MEMORY_EXTRACTION_TIMEOUT_MS':'5432'})
    return values


def prepare_settings(run):
    if run.child is not None or run.descriptor.get('providerSmoke') is not None or run.descriptor.get('historySetup') != 'use-existing':
        raise ValueError('Stopped keyless existing-installation scope required')
    private_json(run.root / 'config/settings-v3.json', {'version':3,'keys':{},'fields':{
        **preserved_fields(run),'DATABASE_PATH':str(run.database),'MEMORY_ENABLED':'false',
        'SUMMARY_ENABLED':'false','SUMMARY_MODEL':'gpt-6-luna','SUMMARY_CHAR_LIMIT':'6000'},
        'chatCatalog':SUMMARY_CATALOG})
    run.keyless_lifecycle=True  # Read-only API guard forbids provider descriptor/paid chat.


def metadata(run):
    status, value=api(run,'GET','/api/cross-chat-summary')
    if status != 200: raise ValueError('Summary metadata unavailable')
    with contextlib.closing(readonly(run.database)) as db:
        if db.execute('select count(*) from conversation_completion').fetchone()[0] or db.execute('select count(*) from summary_attempt').fetchone()[0]:
            raise ValueError('No inference/source backlog allowed in Settings-only scenario')
    return value


def default_summary(value):
    # Fixed legacy scalar is disabled and keyless: no inference or private slot.
    return not value['enabled'] and value['model'] == 'gpt-6-luna' and value['state'] == 'disabled' and value['pending'] == 0 and value['items'] == 0


def captures(run, state, history=False):
    return [{'state':state,'surface':'history' if history else 'memory','preset':preset,
             **run.settings_action(('captureHistory' if history else 'captureSummary')+preset.title())}
            for preset in ['wide','narrow']]


def verify_saved(run, enabled):
    value=json_document(run.root / 'config/settings-v3.json')[1]
    fields=value['fields']
    if value['keys'] or fields['SUMMARY_ENABLED'] != str(enabled).lower() or fields['SUMMARY_MODEL'] != SUMMARY_CHOICE or fields['SUMMARY_CHAR_LIMIT'] != '6000':
        raise ValueError('Native Save did not persist exact keyless independent fields')
    if any(fields.get(key) != expected for key,expected in preserved_fields(run).items()):
        raise ValueError('Hidden compatibility/executable values changed')
    if fields.get('GARMIN_HISTORY_START_DATE','') != ('2024-01-01' if enabled else ''):
        raise ValueError('Explicit history-limit Save did not preserve scope')


def save(run, enabled, active, models):
    run.settings_action('summaryOn' if enabled else 'summaryOff')
    run.settings_action('legacyLimit' if enabled else 'automatic')
    run.settings_action('save')  # Exactly once; unknown Save is never replayed.
    run.wait_settings(lambda value:value['savedForNextLaunch'] and value['summaryOn' if enabled else 'summaryOff'], 'summary-only pending restart')
    run.settings_action('dismissRestart')
    verify_saved(run,enabled)
    current=metadata(run)
    if current['enabled'] != active or api(run,'GET','/api/model-settings') != models:
        raise ValueError('Save applied restart-only fields or retargeted chat')
    state='On-pending' if enabled else 'Off-pending'
    return captures(run,state)+captures(run,state,history=True)


@resources.invocation
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch',required=True);parser.add_argument('--bundle',required=True)
    args=parser.parse_args();os.umask(0o077)
    evidence=private_directory(resources.configure(canonical(args.scratch)))
    bundle=canonical(args.bundle);source=source_identity();inventory=audit(bundle)
    if json.loads((bundle/'Contents/Resources/resources/provenance.json').read_text())['sourceFingerprint'] != source:
        raise ValueError('Current exact-source ordinary artifact required')
    prepared=prepare(evidence,argparse.Namespace(task_id=os.environ.get('PIVAN_TASK_ID','T0278'),input_file=None,grant_file=None,provenance_file=None,anchor=None),'ordinary')
    run=HistoryRun(evidence,prepared.database,source,bundle,inventory,history_setup='use-existing')
    run.before_start=prepared.verify_current
    observer=Observer(evidence);run.observer=observer
    receipt={'purpose':'Keyless native concise Memory/history Settings and hidden-value preservation','source':source,'syntheticOnly':True,
             'providerDescriptor':False,'privateSlotLookup':False,'providerCalls':0,'scenarioPassed':False,'captures':[]}
    try:
        prepare_settings(run);run.start(run.binary)
        initial=metadata(run)
        models=api(run,'GET','/api/model-settings')
        receipt['initialSummary']=initial
        receipt['initialChat']={'httpStatus':models[0],'available':models[1].get('available'),'options':len(models[1].get('options',[]))}
        if not default_summary(initial) or models[0] != 200 or models[1]['available']:
            raise ValueError('Fixed Off/scalar/no eligible chat choice required')
        original_origin=run.origin
        run.settings_action('open');run.wait_settings(lambda value:value['ready'] and value['summaryOff'] and not value['firstRun'],'initial native summary fields')
        initial_observation=run.settings_action('observe')
        if not initial_observation['technicalControlsAbsent'] or not initial_observation['automaticHistory'] or initial_observation['historyDateVisible']:
            raise ValueError('Technical UI present or Off date not hidden')
        run.wait_settings(lambda value:value['summaryScalar'],'one exact scalar/catalog option with explicit Save binding')
        scalar_before=json_document(run.root/'config/settings-v3.json')[1]
        receipt['captures']+=captures(run,'scalar-exact-match')
        run.settings_action('bindSummary')
        run.wait_settings(lambda value:value['summaryBound'],'explicit draft-only catalog binding')
        if json_document(run.root/'config/settings-v3.json')[1] != scalar_before:
            raise ValueError('Render/draft binding wrote settings')
        receipt['captures']+=captures(run,'catalog-binding-draft')
        run.settings_action('cancelDraft')
        run.wait_settings(lambda value:value['ready'] and value['summaryScalar'],'cancel restores scalar without write')
        if json_document(run.root/'config/settings-v3.json')[1] != scalar_before:
            raise ValueError('Cancel changed saved scalar')
        run.settings_action('bindSummary');run.settings_action('save')
        run.wait_settings(lambda value:value['savedForNextLaunch'] and value['summaryBound'],'explicit catalog identity Save')
        run.settings_action('dismissRestart')
        bound=json_document(run.root/'config/settings-v3.json')[1]
        if bound['fields']['SUMMARY_MODEL'] != CLOUD_CHOICE or bound['keys'] or metadata(run)['model'] != 'gpt-6-luna':
            raise ValueError('Binding failed identity/keyless/restart-only preservation')
        run.stop();run.start(run.binary)
        if metadata(run)['model'] != CLOUD_CHOICE or metadata(run)['enabled']:
            raise ValueError('Explicit binding did not persist across owned restart')
        run.settings_action('open');run.wait_settings(lambda value:value['ready'] and value['summaryBound'],'bound catalog reload after restart')
        receipt['scalarBindingSaveCancelRestart']=True
        original_origin=run.origin
        run.settings_action('historyRequired')
        before_required=json_document(run.root/'config/settings-v3.json')[1]
        run.settings_action('save')
        required=run.settings_action('observe')
        if required['saveSubmitted'] or not required['historyValidationBlocked'] or not required['historyValueMissing'] or not required['historyDateVisible'] or not required['historyDateRequired']:
            raise ValueError('Empty enabled history date was not required')
        if json_document(run.root/'config/settings-v3.json')[1] != before_required:
            raise ValueError('Rejected empty-date Save changed settings')
        receipt['captures']+=captures(run,'On-empty-required',history=True)
        receipt['emptyDateRequired']=True
        receipt['captures']+=save(run,True,False,models)
        if run.http('/identity')['origin'] != original_origin: raise ValueError('Native Save restarted backend')
        run.stop();run.start(run.binary)
        active=metadata(run)
        if not active['enabled'] or active['model'] != SUMMARY_CHOICE or api(run,'GET','/api/model-settings') != models: raise ValueError('Owned restart failed independent On without chat retarget')
        run.settings_action('open');run.wait_settings(lambda value:value['ready'] and value['summaryOn'] and value['legacyLimit'] and value['technicalControlsAbsent'],'reloaded native On/catalog/6000/history')
        verify_saved(run,True)
        receipt['captures']+=save(run,False,True,models)
        run.stop();run.start(run.binary)
        if metadata(run)['enabled'] or api(run,'GET','/api/model-settings') != models: raise ValueError('Owned restart failed Off or changed chat')
        run.settings_action('open');run.wait_settings(lambda value:value['ready'] and value['summaryOff'] and value['automaticHistory'] and not value['historyDateVisible'] and value['technicalControlsAbsent'],'reloaded native Off/catalog/6000/automatic')
        verify_saved(run,False)
        run.settings_action('close')
        if source_identity()!=source or audit(bundle)!=inventory: raise ValueError('Source/artifact changed')
        receipt.update({'savedOnOff':True,'reloadedOnOff':True,'pendingUntilOwnedRestart':True,'chatUnchanged':True,'hiddenValuesPreserved':True,'technicalControlsAbsent':True,'historyLimitSavedReloadedDisabled':True,'scenarioPassed':True})
    finally:
        with resources.preserve_failure():
            run.stop();run.verify_settled()
            receipt['noninterference']=observer.stop(run.pids)
            prepared.verify_current()
            with contextlib.closing(readonly(prepared.database)) as db:receipt['inputUnchanged']=fingerprint(db)==prepared.original
            receipt['allOwnedProcessesSettled']=True
            private_json(evidence/('summary-settings-'+str(uuid.uuid4())+'.json'),receipt)
    print(json.dumps({'scenarioPassed':receipt['scenarioPassed'],'providerCalls':0,'privateSlotLookup':False}))


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt('Owned Settings interrupted')))
    main()
