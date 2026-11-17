/*
 * Workday "My Experience": Work Experience, Education and Websites entries.
 *
 * The answers for this page come back from an AI service one field at a time,
 * without knowing which entry a field belongs to, so every Work Experience
 * entry got the same job and invented dates, and the same website was added
 * twice. Here each entry is filled from the matching profile entry instead
 * (entry 1 from the first job, entry 2 from the second, ...):
 *  - job title, company, location, from / to, description: from the profile;
 *  - school, degree, field of study, GPA, years: from the profile;
 *  - websites: each profile link once;
 *  - languages: entry 1 from the first profile language, entry 2 from the
 *    second, ... with its level in the proficiency lists and "I am fluent"
 *    ticked only for a native / fluent / advanced level. (Before, every
 *    language entry got "English" and Workday refused the page with
 *    "Duplicate language entries are not allowed".)
 * Social profile questions ("Facebook profile URL") only get a link to that
 * site from the profile, else they are left empty (the portfolio link used
 * to go there and Workday refused it as an invalid Facebook URL).
 * A field the profile has no value for is left empty (never guessed), and
 * extra entries (more than the profile has, or duplicate websites) are
 * deleted. Nothing is made up: dates come only from the profile, and an entry
 * whose end date is before its start date gets no dates at all.
 *
 * After the page is filled, reconcile() checks every Work Experience entry in
 * page order against the profile job at the same place and corrects title,
 * company, location, description, "I currently work here" and from / to
 * (Workday's resume parse pre-fills entries, e.g. the same job twice with a
 * start date after its end). It adds missing entries and deletes extra ones.
 *
 * Copied into atsAutomation.bundle.js (between the LAZY_WD_SECTIONS markers)
 * and loaded on its own by the tests.
 */
(function (g) {
  "use strict";
  if (g.__lazyWdSections) return;

  const str = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  // "2023-01", "2023-01-15", "01/2023", "1/2023", "Jan 2023", "January 2023", "2023" -> {m, y} or null.
  function parseDate(v) {
    const s = str(v).toLowerCase();
    if (!s || /^(present|current|now|today)$/.test(s)) return null;
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?/.exec(s))) return ok(+m[2], +m[1]);
    if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s))) return ok(+m[1], +m[2]);
    if ((m = /^(\d{1,2})[-/.]\d{1,2}[-/.](\d{4})$/.exec(s))) return ok(+m[1], +m[2]);
    if ((m = /^([a-z]{3,9})\.?,? (\d{4})$/.exec(s)) && MONTHS[m[1].slice(0, m[1] === "sept" ? 4 : 3)]) return ok(MONTHS[m[1].slice(0, 3)], +m[2]);
    if ((m = /^(\d{4})$/.exec(s))) return { m: 0, y: +m[1] };
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const d = new Date(t);
      return ok(d.getUTCMonth() + 1, d.getUTCFullYear());
    }
    return null;
    function ok(mo, y) {
      return mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100 ? { m: mo, y } : null;
    }
  }
  const mmYYYY = (d) => (d && d.m ? String(d.m).padStart(2, "0") + "/" + d.y : "");
  const isCurrent = (w) => w.currentlyWorkHere === true || /^(present|current|now)$/i.test(str(w.endDate));
  const nameOf = (v) => (v && typeof v === "object" ? str(v.name || v.title || "") : str(v));

  function jobs(profile) {
    const list = (profile && profile.resume_data && profile.resume_data.workExperience) || [];
    return list.filter((w) => w && (str(w.jobTitle) || nameOf(w.company)));
  }
  function schools(profile) {
    const list = (profile && profile.resume_data && profile.resume_data.education) || [];
    return list.filter((e) => e && nameOf(e.institution));
  }
  // Every link in the profile, each once (LinkedIn first).
  function links(profile) {
    const rd = (profile && profile.resume_data) || {};
    // Links live in "miscellaneous" (linkedinUrl, portfolioUrl, githubUrl...);
    // older profiles kept some in personal information.
    const p = Object.assign({}, rd.personalInformation || {}, rd.miscellaneous || {});
    const out = [];
    const seen = new Set();
    const add = (u) => {
      u = str(u);
      if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(u)) return;
      const k = u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
      if (seen.has(k)) return;
      seen.add(k);
      out.push(u);
    };
    const keys = Object.keys(p).sort((a, b) => (/linkedin/i.test(b) ? 1 : 0) - (/linkedin/i.test(a) ? 1 : 0));
    for (const k of keys) {
      const v = p[k];
      if (Array.isArray(v)) v.forEach(add);
      else if (typeof v === "string" && /linkedin|github|portfolio|website|url|link|site|blog|twitter/i.test(k)) add(v);
    }
    return out;
  }

  // Degree text for the Degree list: "Master of Science" / "BSc ..." / degree type.
  function degreeText(e) {
    const d = e.degree;
    if (d && typeof d === "object") return str(d.degreeName) || str(d.degreeType);
    return str(d);
  }
  // Field of study: the profile's specialisation, else what follows the degree
  // in its name ("BSc Exercise and Sport Sciences" -> "Exercise and Sport Sciences").
  function fieldOfStudy(e) {
    const d = e.degree && typeof e.degree === "object" ? e.degree : {};
    const sp = Array.isArray(d.specialization) ? d.specialization.map(str).filter(Boolean) : str(d.specialization) ? [str(d.specialization)] : [];
    if (sp.length) return sp[0];
    const name = str(d.degreeName || e.degree);
    const m = /^(?:b\.?\s?sc|bsc|b\.?\s?a|ba|b\.?\s?eng|beng|m\.?\s?sc|msc|m\.?\s?a|ma|mba|meng|m\.?\s?eng|phd|ph\.?d\.?|llb|llm|bachelor(?:'s)?(?: of [a-z]+)?|master(?:'s)?(?: of [a-z]+)?|doctor(?:ate)?(?: of [a-z]+)?|postgraduate (?:diploma|certificate)|graduate diploma|diploma|certificate(?: [ivx]+)?)\.?\s+(?:in\s+|of\s+)?(.{3,})$/i.exec(name);
    return m ? str(m[1]) : "";
  }

  // Which entry an element belongs to: {kind, index, group, section} or null.
  // Workday labels each entry panel "Work-Experience-2-...", "Education-1-...",
  // "Websites-3-..." (aria-labelledby) inside a "...-section" group.
  const KIND_RE = [
    ["work", /^work-?experience/i],
    ["edu", /^education/i],
    ["web", /^web-?sites?|^web-?address/i],
  ];
  const kindOf = (label) => {
    for (const [k, re] of KIND_RE) if (re.test(label)) return k;
    return "";
  };
  function entryOf(el) {
    if (!el || !el.closest) return null;
    for (let n = el.closest('[role="group"][aria-labelledby]'); n; n = n.parentElement && n.parentElement.closest('[role="group"][aria-labelledby]')) {
      const label = n.getAttribute("aria-labelledby") || "";
      if (/-section$/i.test(label)) return null; // in a section but not in an entry
      const kind = kindOf(label);
      if (!kind) continue;
      const section = n.parentElement && n.parentElement.closest('[role="group"][aria-labelledby$="-section"]');
      const all = section ? groupsIn(section, kind) : [n];
      let index = all.indexOf(n);
      if (index < 0) {
        const d = /-(\d+)(?:-|$)/.exec(label);
        index = d ? +d[1] - 1 : 0;
      }
      return { kind, index, group: n, section };
    }
    return null;
  }
  function groupsIn(section, kind) {
    return Array.from(section.querySelectorAll('[role="group"][aria-labelledby]')).filter((x) => {
      const l = x.getAttribute("aria-labelledby") || "";
      if (x === section || /-section$/i.test(l) || kindOf(l) !== kind) return false;
      // Only entries directly in this section (not groups nested inside an entry).
      const up = x.parentElement && x.parentElement.closest('[role="group"][aria-labelledby]');
      return up === section;
    });
  }

  // Should this Work Experience entry have "I currently work here" ticked?
  function isCurrentGroup(profile, group) {
    const at = entryOf(group.querySelector("input, textarea, button") || group);
    const W = jobs(profile);
    if (!at || at.kind !== "work" || !W.length) return true; // no profile to go by: as before
    return at.index < W.length && isCurrent(W[at.index]);
  }

  // The profile field an element stands for, from its id / automation id / label.
  function fieldOf(el, question) {
    const id = [el.id, el.getAttribute && el.getAttribute("data-automation-id"), el.getAttribute && el.getAttribute("name"), el.getAttribute && el.getAttribute("data-fkit-id")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const q = str(question).toLowerCase();
    const t = id + " | " + q;
    if (/jobtitle|job title/.test(t)) return "title";
    if (/companyname|\bcompany\b/.test(t)) return "company";
    if (/currentlyworkhere|currently work/.test(t)) return "current";
    if (/startdate|start date|\bfrom\b/.test(t)) return "start";
    if (/enddate|end date|\bto\b/.test(t)) return "end";
    if (/roledescription|role description|description/.test(t)) return "description";
    if (/schoolname|school|university|college|institution/.test(t)) return "school";
    if (/fieldofstudy|field of study|major/.test(t)) return "field";
    if (/degree/.test(t)) return "degree";
    if (/gradeaverage|gpa|overall result|grade/.test(t)) return "gpa";
    if (/firstyearattended|first year|from year/.test(t)) return "firstYear";
    if (/lastyearattended|last year|to year|graduat/.test(t)) return "lastYear";
    if (/\burl\b|webaddress|website/.test(t)) return "url";
    if (/location|city/.test(t)) return "location";
    return "";
  }

  function workValue(w, field) {
    if (!w) return null;
    const s = parseDate(w.startDate);
    const e = isCurrent(w) ? null : parseDate(w.endDate);
    const datesOk = !(s && e && (e.y < s.y || (e.y === s.y && e.m && s.m && e.m < s.m)));
    switch (field) {
      case "title":
        return str(w.jobTitle);
      case "company":
        return nameOf(w.company);
      case "location":
        return str(w.workLocation || w.location);
      case "start":
        return mmYYYY(s);
      case "end":
        return datesOk && !isCurrent(w) ? mmYYYY(e) : "";
      case "description":
        return Array.isArray(w.description) ? w.description.map(str).filter(Boolean).join("\n") : str(w.description);
      default:
        return null; // not a field this entry decides
    }
  }
  function eduValue(e, field) {
    if (!e) return null;
    const s = parseDate(e.startDate);
    const en = parseDate(e.endDate);
    switch (field) {
      case "school":
        return nameOf(e.institution);
      case "degree":
        return degreeText(e);
      case "field":
        return fieldOfStudy(e);
      case "gpa":
        return str(e.gpa);
      case "firstYear":
        return s ? String(s.y) : "";
      case "lastYear":
        return en ? String(en.y) : "";
      default:
        return null;
    }
  }

  // ---- Languages ----------------------------------------------------------
  // Profile languages: [{language, level}], each language once.
  function languages(profile) {
    const list = (profile && profile.resume_data && profile.resume_data.languages) || [];
    const out = [];
    const seen = new Set();
    for (const l of list) {
      const name = l && typeof l === "object" ? str(l.language || l.name) : str(l);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, level: l && typeof l === "object" ? str(l.level || l.proficiency || l.fluency) : "" });
    }
    return out;
  }
  // 5 native, 4 fluent / advanced, 3 intermediate, 2 basic, 1 none.
  const LEVELS = [
    [5, /\b(native|bilingual|mother ?tongue|first language|c2)\b/],
    [4, /\b(fluent|fluency|advanced|proficient|full professional|expert|excellent|c1)\b/],
    [3, /\b(intermediate|professional working|working proficiency|conversational|good|b2|b1|moderate|competent)\b/],
    [2, /\b(basic|beginner|elementary|limited|foundational|novice|a2|a1|fair)\b/],
    [1, /\b(no proficiency|none)\b/],
  ];
  function levelRank(text) {
    const t = str(text).toLowerCase();
    if (!t) return 0;
    for (const [r, re] of LEVELS) if (re.test(t)) return r;
    const d = /^([1-5])\b/.exec(t); // "4 - ..." scales
    return d ? +d[1] : 0;
  }
  const isFluent = (level) => levelRank(level) >= 4;
  // The option matching the profile level: the same level, else the closest
  // lower one (never claims more than the profile says), else the closest.
  function levelOption(options, level) {
    const want = levelRank(level);
    if (!want || !Array.isArray(options)) return null;
    const ranked = options
      .map((o) => (typeof o === "object" && o ? o.label || o.text || o.value : o))
      .filter((o) => o && !/^(select|select one|choose)/i.test(str(o)))
      .map((o) => ({ o, r: levelRank(o) }))
      .filter((x) => x.r);
    if (!ranked.length) return null;
    const same = ranked.find((x) => x.r === want);
    if (same) return same.o;
    const lower = ranked.filter((x) => x.r < want).sort((a, b) => b.r - a.r)[0];
    if (lower) return lower.o;
    return ranked.sort((a, b) => Math.abs(a.r - want) - Math.abs(b.r - want))[0].o;
  }
  // "language-57--language" -> "language-57" (Workday numbers keep growing,
  // so the entry's place comes from the page order, not from the number).
  const LANG_ID = /^(language-\d+)--/i;
  const langPrefix = (el) => {
    const m = el && el.id && LANG_ID.exec(el.id);
    return m ? m[1].toLowerCase() : "";
  };
  function langEntryOf(el) {
    const pre = langPrefix(el);
    if (!pre) return null;
    const doc = el.ownerDocument || (typeof document !== "undefined" ? document : null);
    const order = [];
    if (doc) {
      for (const x of doc.querySelectorAll('[id^="language-"]')) {
        const p = langPrefix(x);
        if (p && !order.includes(p)) order.push(p);
      }
    }
    let index = order.indexOf(pre);
    if (index < 0) index = 0;
    // The entry panel: the widest box around it holding only this entry.
    let group = null;
    for (let n = el.parentElement; n && (!doc || n !== doc.body); n = n.parentElement) {
      const others = Array.from(n.querySelectorAll('[id^="language-"]')).some((x) => langPrefix(x) && langPrefix(x) !== pre);
      if (others) break;
      group = n;
    }
    return { kind: "lang", index, group: group || el.parentElement, prefix: pre };
  }
  function langField(el, question) {
    if (/--language$/i.test(el.id || "")) return "language";
    if ((el.type || "").toLowerCase() === "checkbox" || /fluent in this language/i.test(str(question))) return "fluent";
    return "level";
  }

  // ---- Social profile links -----------------------------------------------
  const SOCIAL = [
    ["facebook", /facebook/i, /(^|\.)facebook\.com$|(^|\.)fb\.com$/i],
    ["twitter", /twitter|\bx\.com\b|\bx profile\b/i, /(^|\.)(twitter|x)\.com$/i],
    ["instagram", /instagram/i, /(^|\.)instagram\.com$/i],
    ["github", /github/i, /(^|\.)github\.com$/i],
    ["linkedin", /linked ?in/i, /(^|\.)linkedin\.com$/i],
  ];
  const hostOf = (u) => {
    try {
      return new URL(str(u)).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  };
  // For a "Facebook / Twitter / ... profile" question: the profile's link to
  // that site, "" when it has none, or null when the question is not one.
  function socialLink(question, profile) {
    const q = str(question);
    if (!/\b(url|link|profile|handle|page|account)\b/i.test(q)) return null;
    const hits = SOCIAL.filter(([, re]) => re.test(q));
    if (hits.length !== 1) return null;
    const host = hits[0][2];
    return links(profile).find((u) => host.test(hostOf(u))) || "";
  }

  function clickDelete(group) {
    const b =
      group.querySelector('button[data-automation-id="panel-set-delete-button"]') ||
      Array.from(group.querySelectorAll("button")).find((x) => /^delete$/i.test(str(x.textContent)) || /delete/i.test(x.getAttribute("aria-label") || ""));
    if (b) {
      b.click();
      return true;
    }
    return false;
  }

  /**
   * @param {object} profile  LazyApply profile ({resume_data: {...}})
   * @param {Array}  questions the page's fields with the AI's answers
   *                 ({type, question, element, answer, checkboxOptions, ...})
   * @returns {Array} the questions to fill, with entry fields answered from the profile
   */
  function fix(profile, questions) {
    if (!Array.isArray(questions) || !questions.length) return questions;
    const W = jobs(profile);
    const E = schools(profile);
    const L = links(profile);
    const LG = languages(profile);
    const keep = [];
    const extra = new Set(); // groups to delete
    let langSet = 0;
    for (const q of questions) {
      const el = q && (q.element || (q.checkboxOptions && q.checkboxOptions[0]) || (q.radioOptions && q.radioOptions[0]));
      const lang = langEntryOf(el);
      if (lang) {
        if (!LG.length) {
          keep.push(q); // no languages in the profile: leave the page as it was
          continue;
        }
        if (lang.index >= LG.length) {
          extra.add(lang.group);
          continue;
        }
        const want = LG[lang.index];
        const field = langField(el, q.question);
        if (field === "language") {
          q.answer = want.name;
        } else if (field === "fluent") {
          const box = q.checkboxOptions && q.checkboxOptions[0];
          if (box && !!box.checked !== isFluent(want.level)) {
            try {
              box.click();
            } catch (e) {}
          }
          continue; // ticked (or not) here, not by the AI answer
        } else {
          const opt = levelOption(q.options, want.level);
          if (!opt) {
            keep.push(q); // level unknown or no option matches: AI answer kept
            continue;
          }
          q.answer = opt;
        }
        q.__lazyFromProfile = true;
        langSet++;
        keep.push(q);
        continue;
      }
      const at = entryOf(el);
      if (!at) {
        const social = socialLink(q && q.question, profile);
        if (social === "") continue; // no link to that site: left empty
        if (social) {
          q.answer = social;
          q.__lazyFromProfile = true;
        }
        keep.push(q);
        continue;
      }
      const field = fieldOf(el, q.question);
      let value = null;
      if (at.kind === "work") {
        if (at.index >= W.length) {
          if (W.length) extra.add(at.group);
          if (!W.length) keep.push(q); // no jobs in the profile: leave the page as it was
          continue;
        }
        if (field === "current") {
          // Ticked only for a job that is current in the profile (set here,
          // not left to the AI answer).
          const box = q.checkboxOptions && q.checkboxOptions[0];
          if (box && !!box.checked !== isCurrent(W[at.index])) {
            try {
              box.click();
            } catch (e) {}
          }
          continue;
        }
        value = workValue(W[at.index], field);
      } else if (at.kind === "edu") {
        if (at.index >= E.length) {
          if (E.length) extra.add(at.group);
          if (!E.length) keep.push(q);
          continue;
        }
        value = eduValue(E[at.index], field);
      } else if (at.kind === "web") {
        if (field === "url" || !field) {
          if (at.index >= L.length) {
            extra.add(at.group);
            continue;
          }
          value = L[at.index];
        }
      }
      if (value === null) {
        keep.push(q); // a field this module does not decide
        continue;
      }
      if (!value) continue; // the profile has nothing for it: left empty, never guessed
      q.answer = value;
      q.__lazyFromProfile = true;
      keep.push(q);
    }
    try {
      if (self.__lazyDbg) self.__lazyDbg.log("field", "info", "Workday My Experience: " + questions.filter((q) => q && q.__lazyFromProfile).length + " fields set from your profile (" + W.length + " jobs, " + E.length + " schools, " + L.length + " links, " + LG.length + " languages, " + langSet + " language fields), " + extra.size + " extra entries removed, " + (questions.length - keep.length) + " fields left empty");
    } catch (e) {}
    // Extra entries are removed, last first so the others keep their place.
    Array.from(extra)
      .reverse()
      .forEach((grp) => {
        try {
          clickDelete(grp);
        } catch (e) {}
      });
    return keep;
  }

  // ---- Final check of every Work Experience entry ---------------------------
  // Workday pre-fills entries from the uploaded resume, often wrongly (the
  // same job twice, a start date from another job). After the page is filled,
  // each entry is compared with the profile job at the same place (entry 1 =
  // first job, ...) and corrected: title, company, location, description,
  // "I currently work here", from / to. Missing entries are added, extra ones
  // deleted. Values are set through the input's native setter so Workday's
  // React state takes them (a plain `el.value = x` is reverted).
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const same = (a, b) => str(a).toLowerCase() === str(b).toLowerCase();
  function nativeSet(el, v) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    try {
      el.focus();
    } catch (e) {}
    if (d && d.set) d.set.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    try {
      el.blur();
    } catch (e) {}
  }
  const visible = (el) => {
    try {
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility === "visible";
    } catch (e) {
      return true;
    }
  };
  function workGroups(root) {
    const doc = root && root.querySelectorAll ? root : document;
    const seen = new Map();
    for (const n of doc.querySelectorAll('[role="group"][aria-labelledby]')) {
      const l = n.getAttribute("aria-labelledby") || "";
      if (/-section$/i.test(l) || kindOf(l) !== "work") continue;
      const at = entryOf(n.querySelector("input, textarea, button") || n);
      if (at && at.kind === "work" && at.group === n && !seen.has(n)) seen.set(n, at.index);
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[1] - b[1])
      .map((x) => x[0]);
  }
  function workSection(root) {
    const doc = root && root.querySelectorAll ? root : document;
    return Array.from(doc.querySelectorAll('[role="group"][aria-labelledby$="-section"]')).find((n) => /work-?experience/i.test(n.getAttribute("aria-labelledby") || "")) || null;
  }
  function addButton(section) {
    if (!section) return null;
    const own = Array.from(section.querySelectorAll('button[data-automation-id="add-button"], button')).filter((b) => {
      const up = b.closest('[role="group"][aria-labelledby]');
      return up === section && (b.getAttribute("data-automation-id") === "add-button" || /^add( another)?$/i.test(str(b.textContent)));
    });
    return own[own.length - 1] || null;
  }
  const labelOf = (el) => {
    const id = el.id;
    const lab = id && el.ownerDocument && el.ownerDocument.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    return str((lab && lab.textContent) || el.getAttribute("aria-label") || "");
  };
  // {month, year} spin boxes of a date in this entry ("start" / "end").
  function dateBoxes(group, which) {
    const wraps = Array.from(group.querySelectorAll('[data-automation-id="dateInputWrapper"]')).filter(visible);
    let w = wraps.find((x) => new RegExp(which === "start" ? "startdate" : "enddate", "i").test((x.id || "") + " " + (x.getAttribute("data-fkit-id") || "") + " " + ((x.querySelector("input") || {}).id || "")));
    if (!w) {
      const lab = which === "start" ? /^from\b|start/i : /^to\b|end/i;
      const caption = (x) => {
        const box = x.closest("fieldset") || x.parentElement || x;
        const l = box.querySelector("legend, label");
        return str(l && l.textContent);
      };
      w = wraps.find((x) => lab.test(caption(x)));
    }
    if (!w && wraps.length === 2) w = which === "start" ? wraps[0] : wraps[1];
    if (!w) return null;
    const spins = Array.from(w.querySelectorAll('input[role="spinbutton"], input'));
    const kind = (e) => ((e.getAttribute("aria-label") || "") + " " + (e.getAttribute("data-automation-id") || "")).toLowerCase();
    return { wrap: w, month: spins.find((e) => kind(e).includes("month")) || null, year: spins.find((e) => kind(e).includes("year")) || null };
  }
  const boxVal = (el) => str(el && (el.value || el.getAttribute("aria-valuetext") || "")).replace(/\D/g, "");
  async function setBox(el, v) {
    const ats = typeof globalThis !== "undefined" && globalThis.__lazyAts;
    if (ats && ats.setDateParts) await ats.setDateParts([[el, v]]);
    else {
      nativeSet(el, v);
      await sleep(80);
    }
  }
  async function setDate(group, which, d, log) {
    const b = dateBoxes(group, which);
    if (!b || !d) return;
    const mm = d.m ? String(d.m).padStart(2, "0") : "";
    const yy = String(d.y);
    const nowM = boxVal(b.month).padStart(2, "0");
    const nowY = boxVal(b.year);
    if ((mm && b.month && nowM !== mm) || (b.year && nowY !== yy)) {
      if (mm && b.month) await setBox(b.month, mm);
      if (b.year) await setBox(b.year, yy);
      log.push(which + " " + (mm ? mm + "/" : "") + yy + " (was " + (nowM || "MM") + "/" + (nowY || "YYYY") + ")");
    }
  }

  async function reconcile(profile, root) {
    const W = jobs(profile);
    if (!W.length) return 0;
    let groups = workGroups(root);
    if (!groups.length && !workSection(root)) return 0; // not the My Experience page
    const changes = [];
    // Add missing entries (Workday's resume parse often makes fewer).
    for (let i = 0; groups.length < W.length && i < W.length; i++) {
      const add = addButton(workSection(root));
      if (!add) break;
      add.click();
      await sleep(900);
      const now = workGroups(root);
      if (now.length <= groups.length) break;
      groups = now;
      changes.push("added entry " + groups.length);
    }
    // Delete extra entries, last first.
    for (let i = groups.length - 1; i >= W.length; i--) {
      if (clickDelete(groups[i])) {
        changes.push("deleted extra entry " + (i + 1));
        await sleep(600);
      }
    }
    groups = workGroups(root).slice(0, W.length);
    for (let i = 0; i < groups.length; i++) {
      const grp = groups[i];
      const w = W[i];
      const log = [];
      for (const el of grp.querySelectorAll("input, textarea")) {
        if (!visible(el) || el.disabled || el.readOnly) continue;
        const t = (el.type || "").toLowerCase();
        if (el.tagName === "INPUT" && t !== "text" && t !== "") continue;
        if (el.getAttribute("role") === "spinbutton" || el.getAttribute("role") === "combobox" || el.closest('[data-automation-id="dateInputWrapper"]')) continue;
        const field = fieldOf(el, labelOf(el));
        if (!/^(title|company|location|description)$/.test(field)) continue;
        const want = workValue(w, field);
        if (!want) continue; // the profile has nothing: leave it
        if (field === "description" ? str(el.value) === str(want) : same(el.value, want)) continue;
        log.push(field + ' "' + str(want).slice(0, 40) + '" (was "' + str(el.value).slice(0, 40) + '")');
        nativeSet(el, want);
        await sleep(120);
      }
      const box = grp.querySelector('input[type="checkbox"][id*="currentlyWorkHere"]') || Array.from(grp.querySelectorAll('input[type="checkbox"]')).find((b) => fieldOf(b, labelOf(b)) === "current");
      if (box && !!box.checked !== isCurrent(w)) {
        box.click();
        log.push("current " + (isCurrent(w) ? "ticked" : "unticked"));
        await sleep(400);
      }
      const s = parseDate(w.startDate);
      const e = isCurrent(w) ? null : parseDate(w.endDate);
      const datesOk = !(s && e && (e.y < s.y || (e.y === s.y && e.m && s.m && e.m < s.m)));
      if (s) await setDate(grp, "start", s, log);
      if (e && datesOk) await setDate(grp, "end", e, log);
      if (log.length) changes.push("entry " + (i + 1) + " (" + (nameOf(w.company) || str(w.jobTitle)) + "): " + log.join(", "));
    }
    try {
      if (self.__lazyDbg) self.__lazyDbg.log("field", changes.length ? "info" : "debug", "Workday Work Experience check: " + (changes.length ? changes.join("; ") : "all " + groups.length + " entries match your profile"));
    } catch (x) {}
    return changes.length;
  }

  g.__lazyWdSections = { fix, reconcile, workGroups, isCurrentGroup,parseDate, links, fieldOfStudy, entryOf, fieldOf, mmYYYY, languages, levelRank, levelOption, langEntryOf, socialLink };
  if (typeof module !== "undefined" && module.exports) module.exports = g.__lazyWdSections;
})(typeof self !== "undefined" ? self : globalThis);
