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


def prepare_settings(run):
    if run.child is not None or run.descriptor.get('providerSmoke') is not None or run.descriptor.get('historySetup') != 'use-existing':
        raise ValueError('Stopped keyless existing-installation scope required')
    private_json(run.root / 'config/settings-v3.json', {'version':3,'keys':{},'fields':{
        'DATABASE_PATH':str(run.database),'AI_PROVIDER':'ollama','MEMORY_ENABLED':'false',
        'SUMMARY_ENABLED':'false','SUMMARY_MODEL':'unselected','SUMMARY_CHAR_LIMIT':'6000'},
        'chatCatalog':{'version':1,'entries':[],'defaultEntryId':None}})
    run.keyless_lifecycle=True  # Read-only API guard forbids provider descriptor/paid chat.


def metadata(run):
    status, value=api(run,'GET','/api/cross-chat-summary')
    if status != 200: raise ValueError('Summary metadata unavailable')
    with contextlib.closing(readonly(run.database)) as db:
        if db.execute('select count(*) from conversation_completion').fetchone()[0] or db.execute('select count(*) from summary_attempt').fetchone()[0]:
            raise ValueError('No inference/source backlog allowed in Settings-only scenario')
    return value


def default_summary(value):
    # Native's literal unselected setting projects to the storage/API empty model ID.
    return not value['enabled'] and value['model'] == '' and value['state'] == 'disabled' and value['pending'] == 0 and value['items'] == 0


def save(run, enabled, active, models):
    run.settings_action('summaryOn' if enabled else 'summaryOff')
    run.settings_action('save')  # Exactly once; unknown Save is never replayed.
    run.wait_settings(lambda value:value['savedForNextLaunch'] and value['summaryOn' if enabled else 'summaryOff'], 'summary-only pending restart')
    run.settings_action('dismissRestart')
    value=json_document(run.root / 'config/settings-v3.json')[1]
    if value['keys'] or value['fields']['SUMMARY_ENABLED'] != str(enabled).lower() or value['fields']['SUMMARY_MODEL'] != 'gpt-6-luna' or value['fields']['SUMMARY_CHAR_LIMIT'] != '6000':
        raise ValueError('Native Save did not persist exact keyless independent fields')
    current=metadata(run)
    if current['enabled'] != active or api(run,'GET','/api/model-settings') != models:
        raise ValueError('Save applied restart-only fields or retargeted chat')
    return [{'state':'On-pending' if enabled else 'Off-pending','preset':preset,
             **run.settings_action('captureSummaryWide' if preset == 'wide' else 'captureSummaryNarrow')} for preset in ['wide','narrow']]


@resources.invocation
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scratch',required=True);parser.add_argument('--bundle',required=True)
    args=parser.parse_args();os.umask(0o077)
    evidence=private_directory(resources.configure(canonical(args.scratch)))
    bundle=canonical(args.bundle);source=source_identity();inventory=audit(bundle)
    if json.loads((bundle/'Contents/Resources/resources/provenance.json').read_text())['sourceFingerprint'] != source:
        raise ValueError('Current exact-source ordinary artifact required')
    prepared=prepare(evidence,argparse.Namespace(task_id='T0270',input_file=None,grant_file=None,provenance_file=None,anchor=None),'ordinary')
    run=HistoryRun(evidence,prepared.database,source,bundle,inventory,history_setup='use-existing')
    run.before_start=prepared.verify_current
    observer=Observer(evidence);run.observer=observer
    receipt={'purpose':'T0270 keyless native summary Settings only','source':source,'syntheticOnly':True,
             'providerDescriptor':False,'privateSlotLookup':False,'providerCalls':0,'scenarioPassed':False,'captures':[]}
    try:
        prepare_settings(run);run.start(run.binary)
        initial=metadata(run)
        models=api(run,'GET','/api/model-settings')
        receipt['initialSummary']=initial
        receipt['initialChat']={'httpStatus':models[0],'available':models[1].get('available'),'options':len(models[1].get('options',[]))}
        if not default_summary(initial) or models[0] != 200 or models[1]['available']:
            raise ValueError('Default Off/unselected/no eligible model required')
        original_origin=run.origin
        run.settings_action('open');run.wait_settings(lambda value:value['ready'] and value['summaryOff'] and not value['firstRun'],'initial native summary fields')
        receipt['captures']+=save(run,True,False,models)
        if run.http('/identity')['origin'] != original_origin: raise ValueError('Native Save restarted backend')
        run.stop();run.start(run.binary)
        active=metadata(run)
        if not active['enabled'] or active['model'] != 'gpt-6-luna' or api(run,'GET','/api/model-settings') != models: raise ValueError('Owned restart failed independent On without chat retarget')
        run.settings_action('open');run.wait_settings(lambda value:value['ready'] and value['summaryOn'],'reloaded native On/Luna/6000')
        receipt['captures']+=save(run,False,True,models)
        run.stop();run.start(run.binary)
        if metadata(run)['enabled'] or api(run,'GET','/api/model-settings') != models: raise ValueError('Owned restart failed Off or changed chat')
        run.settings_action('open');run.wait_settings(lambda value:value['ready'] and value['summaryOff'],'reloaded native Off/Luna/6000')
        run.settings_action('close')
        if source_identity()!=source or audit(bundle)!=inventory: raise ValueError('Source/artifact changed')
        receipt.update({'savedOnOff':True,'reloadedOnOff':True,'pendingUntilOwnedRestart':True,'chatUnchanged':True,'scenarioPassed':True})
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
