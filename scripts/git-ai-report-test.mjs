#!/usr/bin/env node
// Builds a throwaway git repo with known commits and checks git-ai-report.mjs.
// Needs git and Node 22; no network, no API key.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'git-ai-report.mjs');
const root = mkdtempSync(join(tmpdir(), 'git-ai-report-'));
const repo = join(root, 'repo');
const home = join(root, 'home'); // so your own ~/.claude/settings.json is not read
mkdirSync(repo);
mkdirSync(home);
let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
	if (!ok) failed++;
};

const git = (args, env = {}) =>
	execFileSync('git', ['-C', repo, ...args], {
		encoding: 'utf8',
		env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: home, ...env }
	}).trim();
git(['init', '-q', '-b', 'main']);
let n = 0;
const commit = (who, date, msg) => {
	writeFileSync(join(repo, 'f.txt'), String(++n));
	git(['add', 'f.txt']);
	git(['commit', '-q', '-m', msg], {
		GIT_AUTHOR_NAME: who,
		GIT_AUTHOR_EMAIL: `${who}@example.se`,
		GIT_COMMITTER_NAME: who,
		GIT_COMMITTER_EMAIL: `${who}@example.se`,
		GIT_AUTHOR_DATE: date,
		GIT_COMMITTER_DATE: date
	});
	return git(['rev-parse', 'HEAD']);
};
const CC = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const GH = '\n\nCo-authored-by: Claude Sonnet 5.5 <noreply@anthropic.com>'; // GitHub squash style

// Week 2026-W42 (Oct 12-18): four people, six commits, three with a Claude trailer.
const a = commit('anna', '2026-10-12T09:00:00Z', 'Add order form' + CC);
commit('bo', '2026-10-13T09:00:00Z', 'Fix footer');
commit('cecilia', '2026-10-13T10:00:00Z', 'Squashed PR #12' + GH);
const d = commit('david', '2026-10-14T09:00:00Z', 'Refactor cart');
commit('anna', '2026-10-15T09:00:00Z', 'Look-alike trailer\n\nCo-Authored-By: Claudette <claudette@example.se>');
commit('bo', '2026-10-16T09:00:00Z', 'Stepper labels' + CC);
// Reverts: the Claude commit after 2 days (counts), david's after 20 days (outside 14).
commit('bo', '2026-10-14T12:00:00Z', `Revert "Add order form"\n\nThis reverts commit ${a}.`);
// Week 2026-W43 (Oct 19-25): two people only, must be suppressed.
commit('anna', '2026-10-20T09:00:00Z', 'Tweak copy' + CC);
commit('bo', '2026-10-21T09:00:00Z', 'Tweak more');
// Week 2026-W45 (Nov 2-8): the late revert of david's commit, by three people in total.
commit('cecilia', '2026-11-03T09:00:00Z', `Revert "Refactor cart"\n\nThis reverts commit ${d}.`);
commit('david', '2026-11-03T10:00:00Z', 'Docs' + CC);
commit('eva', '2026-11-04T10:00:00Z', 'Docs again');

const run = (extra = []) => {
	const r = spawnSync('node', [script, '--repo', repo, ...extra], {
		encoding: 'utf8',
		env: { ...process.env, HOME: home }
	});
	return { out: r.stdout + r.stderr, code: r.status };
};

let { out, code } = run();
const line = (wk) => out.split('\n').find((l) => l.trim().startsWith(wk)) ?? '';
check('exits 0 with no warnings', code === 0 && /0 warning\(s\)/.test(out), `exit=${code}`);
check(
	'W42: 4 people, 6 commits, 3 with the trailer (GitHub case too, not the look-alike)',
	/2026-W42\s+4\s+6\s+3\s+50%/.test(line('2026-W42')),
	line('2026-W42').trim()
);
check('W42: the Claude commit reverted after 2 days is counted', /50%\s+1\s+0$/.test(line('2026-W42').trimEnd()));
check('W43: two people, suppressed', /suppressed/.test(line('2026-W43')), line('2026-W43').trim());
check('W45: three people, the 20-day-old revert is not counted', /2026-W45\s+3\s+2\s+1\s+50%\s+0\s+0/.test(line('2026-W45')), line('2026-W45').trim());
check('no email address or name in the output', !/@|anna|cecilia|david/.test(out));
check('summary line', /git-ai-report: 3 week\(s\), 2 shown, minimum 3 people per week/.test(out));

({ out } = run(['--min-people', '5']));
check('--min-people 5 suppresses every week', /3 week\(s\), 0 shown/.test(out));

mkdirSync(join(repo, '.claude'));
writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({ attribution: { commit: '' } }));
({ out, code } = run());
check('warns when settings hide the trailer', /warning: .*settings\.local\.json: attribution\.commit is ""/.test(out) && /1 warning\(s\)/.test(out));
writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({ includeCoAuthoredBy: false }));
({ out } = run());
check('warns on the deprecated includeCoAuthoredBy: false', /includeCoAuthoredBy is false/.test(out));

rmSync(root, { recursive: true, force: true });
console.log(failed ? `git-ai-report-test: ${failed} failed` : 'git-ai-report-test: all passed');
process.exit(failed ? 1 : 0);
