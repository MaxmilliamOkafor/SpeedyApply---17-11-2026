/* SpeedyApply 2.28.3 + fixes carried over from the LazyApply / Jobright logs.
   Pulls the patched functions out of content.js and runs them.
   Usage: node tests/sa-plus.test.js */
'use strict';
const fs = require('fs'), path = require('path');
const EXT = path.resolve(__dirname, '../Download SpeedyApply Job Application Autofill Tool');
const src = fs.readFileSync(path.join(EXT, 'content-scripts/content.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };
function fn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1); }
  throw new Error('unbalanced ' + name);
}
const Bj = src.match(/var Bj=(`[^`]*`\.split\(`\.`\))/)[1];
const lib = new Function(`const Bj=${Bj};${fn('Lj')}${fn('Rj')}${fn('saResideYes')}${fn('zj')}${fn('Ij')}${fn('saTidyProfile')}
  return { Rj, zj, Ij, saTidyProfile };`)();

const profile = {
  nameData: { firstName: 'Max', lastName: 'Okafor' },
  employmentData: { age: 26, eligibilityUS: true, sponsorship: false },
  websiteData: { linkedin: 'https://www.linkedin.com/in/me/', github: 'https://github.com/me', personal: 'https://me.dev/', websites: ['http://me.dev', 'https://blog.me.dev'] },
};
const ask = (question, options, saved = []) => lib.zj({ question, options }, [...lib.Ij(profile), ...saved]);

console.log('Keyword matching');
ok(lib.Rj('years of experience in project management', ['age', 'year']) === 1, '"age" is not found inside "management"');
ok(lib.Rj('Do you require visa sponsorship?', ['require', 'sponsorship']) === 2, 'whole words still count');
ok(lib.Rj('Is sponsorship required?', ['require']) === 1, 'a word that starts with the keyword counts ("required")');
ok(lib.Rj('How do you maintain quality?', ['ai']) === 0, '"ai" is not found inside "maintain"');
ok(lib.Rj('Are you 18+?', ['18+']) === 1, 'keywords with regex characters are matched literally');

console.log('Built-in age rule');
ok(ask('How many years of experience do you have in project management?') === null, 'years of experience in management → not answered "Yes"');
ok(ask('What languages do you speak, and for how many years?') === null, 'languages + years → not answered "Yes"');
ok(ask('Are you at least 18 years of age?') === 'Yes', '"at least 18 years of age" → Yes');
ok(ask('Are you over the age of 18?', ['Yes', 'No']) === 'Yes', '"over the age of 18" → Yes');
ok(ask('Will you now or in the future require visa sponsorship?', ['Yes', 'No']) === 'No', 'sponsorship rule still answers');
ok(ask('Please share your LinkedIn profile') === 'https://www.linkedin.com/in/me/', 'LinkedIn rule still answers');

console.log('Reside in …');
{
  const no = [{ keywords: ['reside'], appearances: 1, response: 'No' }]; // a saved "No" must not win
  ok(ask('Do you currently reside in the United States?', ['Yes', 'No'], no) === 'Yes', 'United States → Yes');
  ok(ask('Are you currently living in the UK?', ['Yes', 'No'], no) === 'Yes', 'UK → Yes');
  ok(ask('Are you based in Canada?', ['Yes, I am', 'No, I am not'], no) === 'Yes, I am', 'Canada → the form\'s own "Yes" wording');
  ok(ask('Do you live in Germany?', ['Yes', 'No']) === 'Yes' && ask('Are you located in Switzerland?', ['Yes', 'No']) === 'Yes', 'European countries → Yes');
  ok(ask('Are you currently based in the EU?', ['Yes', 'No']) === 'Yes', 'the EU → Yes');
  ok(ask('Do you currently reside in Australia?', ['Yes', 'No'], no) === 'No', 'Australia → your saved answer');
  ok(ask('Are you willing to relocate to the United States?', ['Yes', 'No'], [{ keywords: ['relocate'], appearances: 1, response: 'No' }]) === 'No', 'relocation is not a residence question');
  ok(ask('Will you require visa sponsorship in the US?', ['Yes', 'No']) === 'No', 'sponsorship keeps its own rule');
}

console.log('Profile tidy');
{
  const p = lib.saTidyProfile({
    jobData: [
      { company: 'Now', startDate: '2023-01', currentlyWorkHere: true, endDate: '2024-05' },
      { company: 'Typo', startDate: '2021-04', currentlyWorkHere: false, endDate: '2020-07' },
      { company: 'Fine', startDate: '2017-08', currentlyWorkHere: false, endDate: '2021-03' },
    ],
    educationData: [{ school: 'X', startDate: '2016-08', endDate: '2020-07' }],
    languageData: [{ language: 'English' }, { language: 'French' }, { language: 'english' }],
    websiteData: { ...profile.websiteData, github: 'https://me.dev' },
  });
  ok(!('endDate' in p.jobData[0]), 'a current role has no end date');
  ok(!('endDate' in p.jobData[1]), 'an end date before the start is dropped');
  ok(p.jobData[2].endDate === '2021-03', 'a normal end date is kept');
  ok(p.educationData[0].endDate === '2020-07', 'education dates are kept');
  ok(p.languageData.map((l) => l.language).join() === 'English,French', 'each language once');
  ok(p.websiteData.github === 'https://me.dev' && p.websiteData.personal === '', 'a website equal to GitHub is not entered twice');
  ok(p.websiteData.websites.join() === 'https://blog.me.dev', 'extra websites that repeat a named one are dropped');
  ok(lib.saTidyProfile(undefined) === undefined, 'no profile → unchanged');
}

console.log('Workday websites');
ok(/async function mI\(e\)\{let saQ=\{LinkedIn:/.test(src) && /t=LA\(e\)\.filter\(e=>!\(saQ\[e\.name\]&&document\.querySelector\(saQ\[e\.name\]\)\)\)/.test(src),
  'LinkedIn/GitHub/website typed into their own questions are not added to Websites again');
ok(/e\(saTidyProfile\(dl\.parse\(t\.profile\)\)\)/.test(src), 'the profile is tidied where the content script loads it');
ok(/textarea`,!0\)\}\/\*\[sa\+\][^]*?try\{self\.__lazyWdSections&&await self\.__lazyWdSections\.reconcile\(\{resume_data:\{workExperience:e\}\},document\)\}catch\(x\)\{\}\}async function lI\(/.test(src),
  'after Work Experience is filled, every entry is checked against your profile (wd-sections.js)');
{
  const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const js = man.content_scripts[0].js;
  ok(js.indexOf('content-scripts/wd-sections.js') === 0 && js.includes('content-scripts/content.js'), 'wd-sections.js loads before content.js');
  ok(fs.existsSync(path.join(EXT, 'content-scripts/wd-sections.js')), 'wd-sections.js is in the extension');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
