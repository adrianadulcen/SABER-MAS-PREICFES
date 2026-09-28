(function () {
  'use strict';
  var state = { institutions: [], students: [], quizzes: [], results: [], questions: [], answers: [], institution: '', grade: '', group: 'all', quiz: '', loaded: false };
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var num = function (v) { var n = Number(v); return Number.isFinite(n) ? n : 0; };
  var pct = function (v) { var n = num(v); return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n)); };
  var ptxt = function (v) { return pct(v).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '%'; };
  var itxt = function (v) { return num(v).toLocaleString('es-CO', { maximumFractionDigits: 0 }); };
  var norm = function (v) { return String(v == null ? '' : v).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
  var qnum = function (q) { var n = Number(q && q.numero); if (Number.isFinite(n) && n) return n; var m = String(q && q.pregunta_codigo || '').match(/\d+/); return m ? Number(m[0]) : 0; };
  var grp = function (s) { return String(s.grupo || s.curso || 'Sin grupo').trim() || 'Sin grupo'; };
  var sort = function (a, b) { return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }); };
  function announce(text, error) {
    var box = $('#teacherDataNotice');
    if (!box) { box = document.createElement('div'); box.id = 'teacherDataNotice'; box.className = 'note'; var main = $('main.content'); if (main) main.prepend(box); }
    if (box) { box.textContent = text; box.style.background = error ? '#fff0ef' : '#eff8f6'; box.style.color = error ? '#9f3430' : '#285c56'; }
  }
  async function allRows(table, columns) {
    var rows = [], start = 0, step = 900, batch;
    do {
      var result = await supabaseClient.from(table).select(columns).range(start, start + step - 1);
      if (result.error) throw new Error(table + ': ' + result.error.message);
      batch = result.data || []; rows = rows.concat(batch); start += step;
      if (start > 100000) throw new Error('Se superó el límite de lectura de ' + table + '.');
    } while (batch.length === step);
    return rows;
  }
  async function load() {
    announce('Conectando con Supabase y cargando los resultados…');
    var data = await Promise.all([
      allRows('instituciones', 'id,nombre,ciudad'),
      allRows('estudiantes', 'id,nombre,codigo_acceso,institucion_id,grado,grupo'),
      allRows('simulacros', 'id,nombre,grado_aplicable,num_preguntas,num_sesiones'),
      allRows('resultados_estudiante', 'id,estudiante_id,simulacro_id,curso,aciertos_totales,porcentaje_global,puntaje_global,nivel_global,mat_pct,lec_pct,soc_pct,cn_pct,ing_pct,area_fuerte,area_critica,recomendacion'),
      allRows('preguntas', 'id,simulacro_id,numero,area,competencia,componente,nivel,respuesta_correcta,simulacro_nombre,sesion,pregunta_codigo,habilidad_evaluada,area_corta'),
      allRows('respuestas_estudiante', 'id,estudiante_id,simulacro_id,pregunta_codigo,respuesta_marcada,es_correcta')
    ]);
    state.institutions = data[0]; state.students = data[1]; state.quizzes = data[2]; state.results = data[3]; state.questions = data[4]; state.answers = data[5];
    if (!state.students.length) throw new Error('No hay estudiantes cargados.');
    var sesionUsuario = window.__sesionUsuario;
    if (sesionUsuario && sesionUsuario.rol === 'docente') {
      state.institution = sesionUsuario.institucion_id;
    } else {
      state.institution = (state.institutions.find(function (i) { return state.students.some(function (s) { return s.institucion_id === i.id; }); }) || {}).id || state.students[0].institucion_id;
    }
    var grades = gradesForInstitution(); state.grade = grades.indexOf('3') >= 0 ? '3' : (grades[0] || '');
    state.group = groupsForGrade().indexOf('3-01') >= 0 ? '3-01' : 'all';
    state.quiz = quizzesForGrade()[0]?.id || state.quizzes[0]?.id || '';
    state.loaded = true; render();
    announce('Datos conectados · ' + itxt(state.students.length) + ' estudiantes · ' + itxt(state.results.length) + ' resultados · ' + itxt(state.questions.length) + ' preguntas · ' + itxt(state.answers.length) + ' respuestas.');
  }
  function institutionStudents() { return state.students.filter(function (s) { return !state.institution || s.institucion_id === state.institution; }); }
  function gradesForInstitution() { return Array.from(new Set(institutionStudents().map(function (s) { return String(s.grado || '').trim(); }).filter(Boolean))).sort(sort); }
  function studentsForGrade() { return institutionStudents().filter(function (s) { return String(s.grado || '').trim() === state.grade; }); }
  function groupsForGrade() { return Array.from(new Set(studentsForGrade().map(grp))).sort(sort); }
  function quizzesForGrade() { return state.quizzes.filter(function (q) { return !q.grado_aplicable || String(q.grado_aplicable) === state.grade; }); }
  function filteredStudents() { return studentsForGrade().filter(function (s) { return state.group === 'all' || grp(s) === state.group; }); }
  function context() {
    var students = filteredStudents(), ids = new Set(students.map(function (s) { return s.id; }));
    var results = state.results.filter(function (r) { return r.simulacro_id === state.quiz && ids.has(r.estudiante_id); });
    var evaluated = new Set(results.map(function (r) { return r.estudiante_id; }));
    var qs = state.questions.filter(function (q) { return q.simulacro_id === state.quiz; }).sort(function (a, b) { return qnum(a) - qnum(b); });
    var quiz = state.quizzes.find(function (q) { return q.id === state.quiz; });
    var total = num(quiz && quiz.num_preguntas) || qs.length, codes = new Map();
    qs.forEach(function (q) { codes.set(norm(q.pregunta_codigo), q); codes.set(String(qnum(q)), q); });
    var answers = state.answers.filter(function (a) { return a.simulacro_id === state.quiz && evaluated.has(a.estudiante_id); }).map(function (a) {
      var digits = String(a.pregunta_codigo || '').match(/\d+/), q = codes.get(norm(a.pregunta_codigo)) || codes.get(digits ? digits[0] : '');
      return Object.assign({}, a, { question: q });
    }).filter(function (a) { return a.question; });
    var qstats = qs.map(function (q) { return questionStats(q, answers, evaluated.size); });
    var areaNames = Array.from(new Set(qs.map(function (q) { return q.area || q.area_corta || 'Sin área'; })));
    var areas = areaNames.map(function (area) { var list = qstats.filter(function (x) { return (x.question.area || x.question.area_corta || 'Sin área') === area; }); var correct = list.reduce(function (n, x) { return n + x.correct; }, 0), denominator = list.length * evaluated.size; return { area: area, correct: correct, denominator: denominator, count: list.length, pct: denominator ? correct / denominator * 100 : 0 }; }).sort(function (a, b) { return b.pct - a.pct; });
    var roster = students.map(function (s) {
      var r = results.find(function (x) { return x.estudiante_id === s.id; });
      var own = answers.filter(function (a) { return a.estudiante_id === s.id; });
      var correct = own.filter(correctAnswer).length, blank = own.filter(function (a) { return isBlank(a.respuesta_marcada); }).length + Math.max(0, total - own.length), multiple = own.filter(function (a) { return isMultiple(a.respuesta_marcada); }).length;
      return { student: s, result: r, total: total, correct: correct, blank: blank, multiple: multiple, wrong: Math.max(0, total - correct - blank - multiple), pct: total ? correct / total * 100 : 0, answers: own };
    });
    return { students: students, results: results, evaluated: evaluated, questions: qs, qstats: qstats, areas: areas, roster: roster, quiz: quiz, total: total };
  }
  function isBlank(v) { return !String(v == null ? '' : v).trim() || ['—', '-', 'N/A'].indexOf(norm(v)) >= 0; }
  function isMultiple(v) { var a = norm(v).replace(/\s/g, ''); return /[A-D][,;/+|][A-D]/.test(a) || /^[A-D]{2,}$/.test(a); }
  function correctAnswer(a) { return typeof a.es_correcta === 'boolean' ? a.es_correcta : norm(a.respuesta_marcada) === norm(a.question && a.question.respuesta_correcta); }
  function questionStats(q, answers, n) {
    var own = answers.filter(function (a) { return a.question.id === q.id; }), correct = own.filter(correctAnswer).length, blank = own.filter(function (a) { return isBlank(a.respuesta_marcada); }).length + Math.max(0, n - own.length), multi = own.filter(function (a) { return isMultiple(a.respuesta_marcada); }).length, opts = { A: 0, B: 0, C: 0, D: 0 };
    own.forEach(function (a) { var v = norm(a.respuesta_marcada); if (Object.prototype.hasOwnProperty.call(opts, v)) opts[v]++; });
    var top = Object.keys(opts).sort(function (a, b) { return opts[b] - opts[a]; })[0];
    return { question: q, correct: correct, blank: blank, multi: multi, wrong: Math.max(0, n - correct - blank - multi), n: n, pct: n ? correct / n * 100 : 0, opts: opts, top: top, key: norm(q.respuesta_correcta) };
  }
  function bar(label, value) { var v = pct(value), cls = v < 30 ? 'low' : v < 50 ? 'warn' : ''; return '<div class="barrow"><span>' + esc(label) + '</span><div class="track"><div class="fill ' + cls + '" style="width:' + v + '%"></div></div><span class="barpct">' + ptxt(v) + '</span></div>'; }
  function badge(value) { return value < 30 ? '<span class="pill red">Refuerzo prioritario</span>' : value < 50 ? '<span class="pill yellow">En desarrollo</span>' : '<span class="pill green">Fortaleza relativa</span>'; }
  function filters() {
    var inst = $('#filterInstitution'), grade = $('#filterGrade'), group = $('#filterGroup'), quiz = $('#filterSimulacro');
    if (inst) {
      var esDocente = window.__sesionUsuario && window.__sesionUsuario.rol === 'docente';
      var allowed = esDocente
        ? state.institutions.filter(function (i) { return i.id === window.__sesionUsuario.institucion_id; })
        : state.institutions.filter(function (i) { return state.students.some(function (s) { return s.institucion_id === i.id; }); });
      inst.innerHTML = allowed.map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.nombre) + '</option>'; }).join('');
      inst.value = state.institution;
      inst.disabled = !!esDocente;
    }
    if (grade) { grade.innerHTML = gradesForInstitution().map(function (g) { return '<option value="' + esc(g) + '">Grado ' + esc(g) + '</option>'; }).join(''); grade.value = state.grade; }
    if (group) { group.innerHTML = '<option value="all">Todos los grupos</option>' + groupsForGrade().map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join(''); group.value = state.group; }
    if (quiz) { var list = quizzesForGrade(); quiz.innerHTML = list.map(function (q) { return '<option value="' + esc(q.id) + '">' + esc(q.nombre) + '</option>'; }).join('') || '<option value="">Sin simulacro para este grado</option>'; if (!list.some(function (q) { return q.id === state.quiz; })) state.quiz = list[0]?.id || ''; quiz.value = state.quiz; }
  }
  function bindFilters() {
    var box = $('#dashboard .titlebar .filters'); if (!box) return;
    box.innerHTML = '<select id="filterInstitution" aria-label="Institución"></select><select id="filterGrade" aria-label="Grado"></select><select id="filterGroup" aria-label="Grupo"></select><select id="filterSimulacro" aria-label="Simulacro"></select><button class="outline" type="button" id="openRoster">♙ Ver estudiantes</button>';
    filters();
    if (!(window.__sesionUsuario && window.__sesionUsuario.rol === 'docente')) {
      $('#filterInstitution').onchange = function (e) { state.institution = e.target.value; var gs = gradesForInstitution(); state.grade = gs.indexOf('3') >= 0 ? '3' : (gs[0] || ''); state.group = 'all'; state.quiz = quizzesForGrade()[0]?.id || ''; render(); };
    }
    $('#filterGrade').onchange = function (e) { state.grade = e.target.value; state.group = 'all'; state.quiz = quizzesForGrade()[0]?.id || ''; render(); };
    $('#filterGroup').onchange = function (e) { state.group = e.target.value; render(); };
    $('#filterSimulacro').onchange = function (e) { state.quiz = e.target.value; render(); };
    $('#openRoster').onclick = function () { go('roster'); };
  }
  function render() { if (!state.loaded) return; var c = context(); filters(); renderDashboard(c); renderCompetencies(c); renderQuestions(c); renderRoster(c); }
  function renderDashboard(c) {
    var best = c.areas[0], focus = c.areas[c.areas.length - 1], easy = c.qstats.slice().sort(function (a, b) { return b.pct - a.pct; })[0], hard = c.qstats.slice().sort(function (a, b) { return a.pct - b.pct; })[0];
    var avg = c.results.length ? c.results.reduce(function (s, r) { return s + num(r.puntaje_global); }, 0) / c.results.length : 0, overall = c.total && c.evaluated.size ? c.qstats.reduce(function (s, q) { return s + q.correct; }, 0) / (c.total * c.evaluated.size) * 100 : 0;
    var school = state.institutions.find(function (i) { return i.id === state.institution; });
    var sesionUsuario = window.__sesionUsuario, crumbEl = $('#headerCrumb'), avatarEl = $('#headerAvatar'), nameEl = $('#headerName');
    if (crumbEl) crumbEl.textContent = (school && school.nombre || 'Institución') + ' / Panel ' + (sesionUsuario && sesionUsuario.rol === 'administrador' ? 'administrador' : 'docente');
    if (avatarEl && sesionUsuario) avatarEl.textContent = sesionUsuario.nombre.split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2).toUpperCase();
    if (nameEl && sesionUsuario) nameEl.textContent = sesionUsuario.nombre + ' · ' + (sesionUsuario.rol === 'administrador' ? 'Administrador' : 'Docente');
    $('#dashboard').innerHTML = '<div class="titlebar"><div><div class="sim-name">' + esc(c.quiz?.nombre || 'SIMULACRO') + ' · GRADO ' + esc(state.grade) + '</div><h1>Resumen del grupo</h1><div class="sub">Resultados calculados desde las respuestas registradas.</div></div><div class="filters"></div></div>' +
      '<div class="grid kpis"><div class="card"><div class="kpihead">Estudiantes evaluados</div><div class="value">' + itxt(c.evaluated.size) + ' <small> / ' + itxt(c.students.length) + '</small></div><div class="hint">' + ptxt(c.students.length ? c.evaluated.size / c.students.length * 100 : 0) + ' de participación</div></div><div class="card"><div class="kpihead">Puntaje promedio del grupo</div><div class="value">' + itxt(avg) + '</div><div class="hint">Según los resultados cargados</div></div><div class="card"><div class="kpihead">Porcentaje de acierto</div><div class="value">' + ptxt(overall) + '</div><div class="hint">' + itxt(c.total) + ' preguntas · todas las áreas</div></div><div class="card"><div class="kpihead">Área de mayor acierto</div><div class="value" style="font-size:20px">' + esc(best?.area || '—') + '</div><div class="hint">' + (best ? ptxt(best.pct) : 'Sin datos') + '</div></div></div>' +
      '<div class="grid middle"><div class="card"><div class="cardtitle"><div><h2>Porcentaje de acierto por área</h2><p>Se calcula con aciertos sobre preguntas aplicadas al grupo.</p></div><span class="badge">' + esc(state.group === 'all' ? 'Todos los grupos' : state.group) + '</span></div><div class="bars">' + (c.areas.map(function (a) { return bar(a.area, a.pct); }).join('') || '<p>No hay información por área.</p>') + '</div><div class="insight"><b>Área para priorizar</b>' + (focus ? esc(focus.area) + ' presenta el menor porcentaje de acierto (' + ptxt(focus.pct) + ').' : 'Sin datos suficientes.') + '</div></div>' +
      '<div class="card"><div class="cardtitle"><div><h2>Comportamiento de preguntas</h2><p>Mayor y menor acierto observado</p></div><button class="link" type="button" id="goQuestions">Ver análisis →</button></div><div class="note" style="margin:0;background:#eff9f6;border-color:#d8eeea;color:#285c56"><b>Mayor acierto · P' + String(easy ? qnum(easy.question) : 0).padStart(2, '0') + '</b><br>' + (easy ? ptxt(easy.pct) + ' · ' + easy.correct + ' de ' + easy.n + ' estudiantes' : 'Sin datos') + '</div><div class="note" style="margin-top:10px"><b>Menor acierto · P' + String(hard ? qnum(hard.question) : 0).padStart(2, '0') + '</b><br>' + (hard ? ptxt(hard.pct) + ' · ' + hard.correct + ' de ' + hard.n + ' estudiantes' : 'Sin datos') + '</div><div class="footnote">Describe este grupo; no determina la dificultad universal de la pregunta.</div></div></div>' +
      '<div class="grid bottom"><div class="card"><div class="cardtitle"><div><h2>Preguntas para revisar</h2><p>Menor porcentaje de acierto primero</p></div><button class="link" type="button" id="goQuestions2">Ver todas →</button></div><div class="tablewrap"><table><thead><tr><th>Pregunta</th><th>Área</th><th>Competencia</th><th>Acierto</th><th>Opción más marcada</th></tr></thead><tbody>' + c.qstats.slice().sort(function (a, b) { return a.pct - b.pct; }).slice(0, 5).map(function (s) { return '<tr><td>P' + String(qnum(s.question)).padStart(2, '0') + '</td><td>' + esc(s.question.area || s.question.area_corta || '—') + '</td><td>' + esc(s.question.competencia || '—') + '</td><td>' + ptxt(s.pct) + '</td><td>' + s.top + ' · ' + itxt(s.opts[s.top]) + (s.top === s.key ? ' · clave' : '') + '</td></tr>'; }).join('') || '<tr><td colspan="5">Sin respuestas para este filtro.</td></tr>' + '</tbody></table></div></div>' +
      '<div class="card"><div class="cardtitle"><div><h2>Recomendaciones para el docente</h2><p>Acciones grupales según los resultados</p></div></div><div class="studentlist">' + (focus ? '<div class="student"><div class="savatar">1</div><div><div class="sname">Priorizar ' + esc(focus.area) + '</div><div class="smeta">Menor porcentaje de acierto: ' + ptxt(focus.pct) + '</div></div></div>' : '') + (hard ? '<div class="student"><div class="savatar">2</div><div><div class="sname">Revisar pregunta P' + qnum(hard.question) + '</div><div class="smeta">' + esc(hard.question.competencia || 'Analizar la habilidad evaluada') + ' · ' + ptxt(hard.pct) + '</div></div></div>' : '') + (c.results.length < c.students.length ? '<div class="student"><div class="savatar">3</div><div><div class="sname">Completar participación</div><div class="smeta">' + itxt(c.students.length - c.results.length) + ' estudiantes sin resultado en este filtro</div></div></div>' : '') + '</div></div></div><div class="footnote">' + esc(school?.nombre || '') + ' · Comparativo histórico disponible al registrar nuevos simulacros.</div>';
    bindFilters(); $('#goQuestions')?.addEventListener('click', function () { go('questions'); }); $('#goQuestions2')?.addEventListener('click', function () { go('questions'); });
  }
  function renderCompetencies(c) {
    var section = $('#competencies'), map = new Map();
    c.qstats.forEach(function (s) { var q = s.question, area = q.area || q.area_corta || 'Sin área', comp = q.competencia || 'Sin competencia', key = area + '||' + comp, g = map.get(key) || { area: area, comp: comp, correct: 0, denominator: 0, questions: [] }; g.correct += s.correct; g.denominator += s.n; g.questions.push(s); map.set(key, g); });
    var areas = {}; map.forEach(function (g) { (areas[g.area] || (areas[g.area] = [])).push(g); });
    section.innerHTML = '<div class="titlebar"><div><div class="eyebrow">Diagnóstico pedagógico</div><h1>Competencias y componentes</h1><div class="sub">Resultados calculados para ' + esc(c.quiz?.nombre || 'el simulacro seleccionado') + '.</div></div></div>' + Object.keys(areas).map(function (a) { var items = areas[a], allCorrect = items.reduce(function (s, x) { return s + x.correct; }, 0), allDen = items.reduce(function (s, x) { return s + x.denominator; }, 0); return '<article class="card" style="margin-bottom:15px"><div class="cardtitle"><div><h2>' + esc(a) + '</h2><p>' + ptxt(allDen ? allCorrect / allDen * 100 : 0) + ' de acierto · ' + items.reduce(function (s, x) { return s + x.questions.length; }, 0) + ' preguntas</p></div>' + badge(allDen ? allCorrect / allDen * 100 : 0) + '</div><div class="bars">' + items.sort(function (x, y) { return x.correct / (x.denominator || 1) - y.correct / (y.denominator || 1); }).map(function (g) { return bar(g.comp, g.correct / (g.denominator || 1) * 100); }).join('') + '</div><div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Competencia</th><th>Componente</th><th>Preguntas</th><th>Acierto</th><th>Habilidad prioritaria</th></tr></thead><tbody>' + items.map(function (g) { var low = g.questions.slice().sort(function (x, y) { return x.pct - y.pct; })[0]; return '<tr><td>' + esc(g.comp) + '</td><td>' + esc(Array.from(new Set(g.questions.map(function (x) { return x.question.componente; }).filter(Boolean))).join(', ') || '—') + '</td><td>' + g.questions.map(function (x) { return 'P' + qnum(x.question); }).join(', ') + '</td><td>' + ptxt(g.correct / (g.denominator || 1) * 100) + '</td><td>' + esc(low?.question.habilidad_evaluada || '—') + '</td></tr>'; }).join('') + '</tbody></table></div></article>'; }).join('') || '<div class="card">No hay competencias asociadas al filtro.</div>';
  }
  function renderQuestions(c) {
    var section = $('#questions'), ordered = c.qstats.slice().sort(function (a, b) { return a.pct - b.pct; }), easy = c.qstats.slice().sort(function (a, b) { return b.pct - a.pct; })[0], hard = ordered[0], blank = c.qstats.slice().sort(function (a, b) { return b.blank - a.blank; })[0], areas = Array.from(new Set(c.questions.map(function (q) { return q.area || q.area_corta || 'Sin área'; })));
    section.innerHTML = '<div class="titlebar"><div><div class="eyebrow">Análisis del grupo</div><h1>Análisis por pregunta</h1><div class="sub">Aciertos, omisiones y opciones marcadas.</div></div><div class="filters"><select id="questionArea"><option value="all">Todas las áreas</option>' + areas.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + '</option>'; }).join('') + '</select><label for="questionNumber">Pregunta</label><input id="questionNumber" type="number" min="1" max="' + c.total + '" value="' + (hard ? qnum(hard.question) : 1) + '" style="width:85px;border:1px solid var(--line);border-radius:8px;padding:9px"><button class="outline" id="showQuestion" type="button">Ver comportamiento</button></div></div>' +
      '<div class="grid kpis"><div class="card"><div class="kpihead">Mayor porcentaje de acierto</div><div class="value">' + (easy ? 'P' + qnum(easy.question) + ' · ' + ptxt(easy.pct) : '—') + '</div><div class="hint">' + esc(easy?.question.area || 'Sin datos') + '</div></div><div class="card"><div class="kpihead">Menor porcentaje de acierto</div><div class="value">' + (hard ? 'P' + qnum(hard.question) + ' · ' + ptxt(hard.pct) : '—') + '</div><div class="hint">' + esc(hard?.question.area || 'Sin datos') + '</div></div><div class="card"><div class="kpihead">Más omitida</div><div class="value">' + (blank ? 'P' + qnum(blank.question) + ' · ' + itxt(blank.blank) : '—') + '</div><div class="hint">Respuestas en blanco</div></div><div class="card"><div class="kpihead">Preguntas de la prueba</div><div class="value">' + itxt(c.total) + '</div><div class="hint">' + itxt(c.evaluated.size) + ' estudiantes evaluados</div></div></div><div id="questionDetail" class="card"></div><div class="card" style="margin-top:15px"><div class="cardtitle"><div><h2>Comportamiento de cada pregunta</h2><p>Ordenado por menor porcentaje de acierto en el grupo</p></div></div><div class="tablewrap"><table><thead><tr><th>Pregunta</th><th>Área</th><th>Competencia</th><th>Componente</th><th>Acierto</th><th>En blanco</th><th>Opción más marcada</th></tr></thead><tbody>' + ordered.map(function (s) { return '<tr><td>P' + String(qnum(s.question)).padStart(2, '0') + '</td><td>' + esc(s.question.area || s.question.area_corta || '—') + '</td><td>' + esc(s.question.competencia || '—') + '</td><td>' + esc(s.question.componente || '—') + '</td><td>' + ptxt(s.pct) + '</td><td>' + itxt(s.blank) + '</td><td>' + s.top + ' · ' + itxt(s.opts[s.top]) + (s.top === s.key ? ' · clave' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    $('#showQuestion').onclick = questionDetail; $('#questionNumber').onkeydown = function (e) { if (e.key === 'Enter') questionDetail(); };
    $('#questionArea').onchange = function (e) { var first = ordered.find(function (s) { return e.target.value === 'all' || (s.question.area || s.question.area_corta || 'Sin área') === e.target.value; }); if (first) { $('#questionNumber').value = qnum(first.question); questionDetail(); } };
    questionDetail();
  }
  function questionDetail() {
    var c = context(), n = Number($('#questionNumber')?.value), s = c.qstats.find(function (x) { return qnum(x.question) === n; }), node = $('#questionDetail'); if (!node) return;
    if (!s) { node.innerHTML = '<div class="insight">No hay resultados para esa pregunta en este simulacro.</div>'; return; }
    node.innerHTML = '<div class="cardtitle"><div><h2>Pregunta ' + String(n).padStart(2, '0') + ' · ' + esc(s.question.area || s.question.area_corta || '—') + '</h2><p>' + esc(s.question.competencia || 'Sin competencia') + ' · ' + esc(s.question.componente || 'Sin componente') + ' · Clave correcta: ' + esc(s.key || '—') + '</p></div>' + badge(s.pct) + '</div><div class="grid kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="note"><b>' + ptxt(s.pct) + ' de acierto</b>' + s.correct + ' de ' + s.n + ' estudiantes</div><div class="note"><b>' + itxt(s.wrong) + ' incorrectas</b>En esta pregunta</div><div class="note"><b>' + itxt(s.blank) + ' en blanco · ' + itxt(s.multi) + ' múltiples</b>Según la captura disponible</div></div><div class="bars">' + ['A', 'B', 'C', 'D'].map(function (x) { return bar(x + (x === s.key ? ' · correcta' : ''), s.n ? s.opts[x] / s.n * 100 : 0).replace('>' + ptxt(s.n ? s.opts[x] / s.n * 100 : 0) + '</span>', '>' + ptxt(s.n ? s.opts[x] / s.n * 100 : 0) + ' · ' + itxt(s.opts[x]) + '</span>'); }).join('') + '</div><div class="insight"><b>Habilidad evaluada</b>' + esc(s.question.habilidad_evaluada || 'Sin descripción en la tabla maestra.') + (s.top !== s.key && s.opts[s.top] ? ' El distractor más marcado fue ' + s.top + '.' : '') + '</div>';
  }
  function renderRoster(c) {
    var section = $('#roster'), rows = c.roster.filter(function (x) { return !!x.result; }).sort(function (a, b) { return sort(grp(a.student), grp(b.student)) || String(a.student.nombre).localeCompare(String(b.student.nombre), 'es'); });
    var avg = rows.length ? rows.reduce(function (s, x) { return s + x.pct; }, 0) / rows.length : 0, blank = rows.length ? rows.reduce(function (s, x) { return s + x.blank; }, 0) / rows.length : 0, multiple = rows.length ? rows.reduce(function (s, x) { return s + x.multiple; }, 0) / rows.length : 0;
    section.innerHTML = '<div class="titlebar"><div><div class="eyebrow">Consulta docente</div><h1>Resultados por estudiante</h1><div class="sub">Resumen del grupo sin revisar cada respuesta individualmente.</div></div><div class="filters"><input id="searchStudent" placeholder="Buscar estudiante" aria-label="Buscar estudiante"></div></div><div class="grid kpis"><div class="card"><div class="kpihead">Estudiantes evaluados</div><div class="value">' + itxt(rows.length) + '</div><div class="hint">de ' + itxt(c.students.length) + ' en el filtro</div></div><div class="card"><div class="kpihead">Porcentaje promedio de acierto</div><div class="value">' + ptxt(avg) + '</div></div><div class="card"><div class="kpihead">Respuestas en blanco</div><div class="value">' + blank.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '<small> promedio</small></div></div><div class="card"><div class="kpihead">Respuestas múltiples</div><div class="value">' + multiple.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + '<small> promedio</small></div></div></div><div class="card"><div class="tablewrap"><table><thead><tr><th>Estudiante</th><th>Grupo</th><th>Puntaje</th><th>Acierto (%)</th><th>Error · cantidad</th><th>En blanco</th><th>Múltiples</th><th>Desempeño</th><th></th></tr></thead><tbody>' + rows.map(function (s) { return '<tr data-student-row="' + esc(s.student.id) + '"><td><b>' + esc(s.student.nombre) + '</b></td><td>' + esc(grp(s.student)) + '</td><td>' + itxt(s.result.puntaje_global) + '</td><td>' + ptxt(s.pct) + '</td><td>' + itxt(s.wrong) + '</td><td>' + itxt(s.blank) + '</td><td>' + itxt(s.multiple) + '</td><td>' + badge(s.pct) + '</td><td><button class="link" type="button" data-student="' + esc(s.student.id) + '">Ver resumen</button></td></tr>'; }).join('') || '<tr><td colspan="9">No hay resultados para este grupo.</td></tr>' + '</tbody></table></div><div class="footnote">El porcentaje se calcula desde las respuestas capturadas; en blanco y múltiples se cuentan por estudiante.</div></div>';
    $('#searchStudent').oninput = function (e) { var term = norm(e.target.value); section.querySelectorAll('[data-student-row]').forEach(function (tr) { tr.style.display = norm(tr.innerText).includes(term) ? '' : 'none'; }); };
    section.querySelectorAll('[data-student]').forEach(function (b) { b.onclick = function () { var s = rows.find(function (x) { return x.student.id === b.dataset.student; }); if (s) openSummary(s, c); }; });
  }
  function openSummary(s, c) {
    var modal = $('#teacherSummary'); if (!modal) return;
    $('#tsName').textContent = s.student.nombre; $('#tsScore').textContent = itxt(s.result.puntaje_global); $('#tsCorrect').textContent = Math.round(s.pct); $('#tsCorrectCount').textContent = '(' + s.correct + '/' + s.total + ')';
    $('#tsWrong').textContent = Math.round(s.total ? s.wrong / s.total * 100 : 0); $('#tsWrongCount').textContent = '(' + s.wrong + '/' + s.total + ')'; $('#tsBlank').textContent = itxt(s.blank); $('#tsMultiple').textContent = itxt(s.multiple);
    var areaCount = {}; s.answers.forEach(function (a) { var area = a.question.area || a.question.area_corta || 'Sin área'; areaCount[area] = areaCount[area] || { n: 0, total: 0 }; areaCount[area].total++; if (correctAnswer(a)) areaCount[area].n++; });
    var ranking = Object.keys(areaCount).sort(function (a, b) { return areaCount[b].n / areaCount[b].total - areaCount[a].n / areaCount[a].total; }), best = ranking[0], focus = ranking[ranking.length - 1];
    $('#tsBest').textContent = best ? best + ' · ' + ptxt(areaCount[best].n / areaCount[best].total * 100) : '—'; $('#tsFocus').textContent = focus ? focus + ' · ' + ptxt(areaCount[focus].n / areaCount[focus].total * 100) : '—';
    var p = modal.querySelector('.studenthero p'); if (p) p.textContent = 'Grado ' + s.student.grado + ' · ' + grp(s.student) + ' · ' + (c.quiz?.nombre || 'Simulacro');
    modal.classList.add('show'); history.pushState({ view: 'roster', modal: true }, '', '#resumen-estudiante');
  }
  document.addEventListener('DOMContentLoaded', function () { load().catch(function (e) { announce('No se pudieron cargar los resultados: ' + e.message, true); var d = $('#dashboard'); if (d) d.innerHTML = '<div class="card"><h1>No fue posible conectar con Supabase</h1><p>Revisa la conexión o los permisos de lectura e intenta actualizar.</p><button class="outline" onclick="location.reload()">Reintentar</button></div>'; }); });
})();
