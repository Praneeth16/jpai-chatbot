"""Marker task: runs only when ae_notifier found new cases.

The PV alert is the task-success e-mail of THIS task. It is configured per deployment (see the comment on task `notify_pv`
in resources/jobs.yml); when no e-mail is configured this task only writes the log line below.
"""
print("New adverse-event candidates were queued for pharmacovigilance. See table pv_cases.")
