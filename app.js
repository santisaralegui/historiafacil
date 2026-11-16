/* app.js - lógica compartida por las páginas de historia clínica de historiafacil.com.
   Cada página define sus campos, su texto generado y sus plantillas, y llama a HF.init(). */

const HF = (() => {
  // Páginas que aparecen en el desplegable del título, en este orden.
  const PAGES = [
    { href: "index.html", label: "Emergencia de adultos" },
    { href: "pediatria.html", label: "Emergencia pediátrica" },
    { href: "ingreso.html", label: "Historia de ingreso" },
    { href: "sala.html", label: "Evolución en sala" },
    { href: "egreso.html", label: "Historia de egreso" },
    { href: "estetica.html", label: "Medicina estética" }
  ];

  // Borrador guardado en este navegador para no perder lo escrito si se cierra la página.
  // Se descarta pasadas DRAFT_MAX_AGE_MS para no mostrar datos de otro paciente en equipos compartidos.
  const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

  let config = {};
  let form;
  let preview;
  let statusEl;
  let antecedentesBox;

  /* ---------- Lectura de campos y armado de texto ---------- */

  function field(name) {
    return document.querySelector(`[data-field="${name}"]`);
  }

  function value(name) {
    const el = field(name);
    if (!el) return "";
    if (el.type === "checkbox" || el.type === "radio") return el.checked;
    return el.value.trim();
  }

  function endDot(text) {
    return `${text}${/[.!?]$/.test(text) ? "" : "."}`;
  }

  function sentence(label, text) {
    if (!text) return "";
    return `${label}: ${endDot(text)}`;
  }

  function line(label, parts) {
    return sentence(label, parts.filter(Boolean).join(", "));
  }

  // Líneas no vacías de un campo de varias líneas.
  function lines(text) {
    return text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  }

  function bullets(label, items) {
    if (!items.length) return "";
    return `${label}:\n${items.map((item) => `- ${endDot(item)}`).join("\n")}`;
  }

  function fieldOrNormal(fieldName, checkboxName, normalText) {
    return value(fieldName) || (value(checkboxName) ? normalText : "");
  }

  function edadTexto(text) {
    if (!text) return "";
    return /(años?|mes(es)?|d[ií]as?|semanas?)\b/i.test(text) ? text : `${text} años`;
  }

  function numbersIn(text) {
    return (text.replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) || []).map(Number);
  }

  /* ---------- Antecedentes personales (filas dinámicas) ---------- */

  function escapeAttr(text) {
    return String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  }

  function addAntecedente(data = {}) {
    const ph = { name: "Ej: DM2, HTA, FA", treatment: "Ej: metformina, losartán", other: "Ej: repercusiones crónicas", ...(config.antecedentePlaceholders || {}) };
    const id = `${Date.now()}-${antecedentesBox.children.length}`;
    const row = document.createElement("div");
    row.className = "antecedente-row";
    row.innerHTML = `
      <label>Antecedente
        <input class="ap-name" name="ap-name-${id}" autocomplete="off" placeholder="${escapeAttr(ph.name)}" value="${escapeAttr(data.name || "")}">
      </label>
      <label>Tratamiento
        <input class="ap-treatment" name="ap-treatment-${id}" autocomplete="off" placeholder="${escapeAttr(ph.treatment)}" value="${escapeAttr(data.treatment || "")}">
      </label>
      <label>Otros
        <input class="ap-other" name="ap-other-${id}" autocomplete="off" placeholder="${escapeAttr(ph.other)}" value="${escapeAttr(data.other || "")}">
      </label>
      <button class="mini-btn" type="button" title="Quitar antecedente">×</button>
    `;

    row.querySelector(".mini-btn").addEventListener("click", () => {
      row.remove();
      if (!antecedentesBox.children.length) addAntecedente();
      update();
    });

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addAntecedente().querySelector(".ap-name").focus();
        }
      });
    });

    antecedentesBox.appendChild(row);
    return row;
  }

  function antecedentesItems() {
    if (!antecedentesBox) return [];
    return [...antecedentesBox.querySelectorAll(".antecedente-row")].map((row) => {
      const name = row.querySelector(".ap-name").value.trim();
      const treatment = row.querySelector(".ap-treatment").value.trim();
      const other = row.querySelector(".ap-other").value.trim();
      if (!name) return "";
      const details = [];
      if (treatment) details.push(`en tratamiento con ${treatment}`);
      if (other) details.push(other);
      return details.length ? `${name} ${details.join(", ")}` : name;
    }).filter(Boolean);
  }

  // Bloque "AP:" con los antecedentes cargados (o "Sin antecedentes a destacar") más los ítems extra.
  function antecedentesTexto(extraItems = []) {
    const apItems = antecedentesItems();
    return bullets("AP", [...(apItems.length ? apItems : ["Sin antecedentes a destacar"]), ...extraItems]);
  }

  function alergiaItems() {
    if (value("sinAlergias")) return ["Sin alergias medicamentosas conocidas"];
    if (value("alergias")) return [`Alergias: ${value("alergias")}`];
    return [];
  }

  /* ---------- Examen físico y ECG de adultos (emergencia, ingreso, sala) ---------- */

  // Una página puede tener más de un examen (p. ej. en emergencia y en sala). Cada uno usa
  // los mismos nombres de campo con un prefijo: "em" + "pa" -> "emPa". Sin prefijo, el nombre tal cual.
  function named(prefix, name) {
    return prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
  }

  function frTextoAdulto(prefix = "") {
    const raw = value(named(prefix, "fr"));
    if (!raw) return "eupneico";
    const [number] = numbersIn(raw);
    if (number !== undefined && number >= 20) return `polipnea de ${raw} rpm`;
    return `FR ${raw} rpm`;
  }

  // Los campos que la página no tenga simplemente no aparecen en el texto.
  function examenAdulto(prefix = "") {
    const v = (name) => value(named(prefix, name));
    const orNormal = (name, normalText) => fieldOrNormal(named(prefix, name), named(prefix, `${name}Normal`), normalText);

    const generalParts = [v("general")];
    if (v("hgt")) generalParts.push(`HGT ${v("hgt")}`);

    const pymParts = [v("pym")];
    if (v("temp")) pymParts.push(`Tax ${v("temp")}`);

    const cvParts = [];
    if (v("pa")) cvParts.push(`PA ${v("pa")} mmHg`);
    if (v("fc")) cvParts.push(`FC ${v("fc")} cpm`);
    if (v("cv")) cvParts.push(v("cv"));

    const ppParts = [frTextoAdulto(prefix)];
    if (v("sat")) ppParts.push(`SatO2 ${v("sat")}`);
    if (v("pp")) ppParts.push(v("pp"));

    const general = generalParts.filter(Boolean).join(", ");

    return [
      general ? `${general}.` : "",
      line("PyM", pymParts),
      line("CV", cvParts),
      line("PP", ppParts),
      sentence("MMII", v("mmii")),
      sentence("ABD", orNormal("abd", "Blando, depresible, indoloro, RHA +")),
      sentence("LG", orNormal("lg", "Sin adenomegalias")),
      sentence("OA", v("oa")),
      sentence("PNM", orNormal("pnm", "Glasgow 15, pupilas reactivas y simétricas, sin síndrome focal neurológico, sin rigidez de nuca")),
      sentence("FFLL", orNormal("ffll", "Libres e indoloras")),
      v("otrosEf") ? endDot(v("otrosEf")) : ""
    ].filter(Boolean).join("\n");
  }

  function ecgNormalDescripcion(prefix = "") {
    const frecuencia = value(named(prefix, "ecgFrecuencia")) || "80";
    return `RS ${frecuencia} lpm, intervalo PR de duración normal, QRS fino, sin alteraciones del ST ni otros signos de isquemia aguda`;
  }

  function ecgTexto(prefix = "") {
    if (!value(named(prefix, "incluirEcg"))) return "";
    if (!value(named(prefix, "ecgNormal"))) return sentence("ECG", value(named(prefix, "ecgDescripcion")));
    return sentence("ECG", ecgNormalDescripcion(prefix));
  }

  // Cada bloque .ecg-options de la página, con sus campos. data-prefix indica el prefijo de sus
  // campos; data-collapse hace que, con el ECG desmarcado, solo se vea la casilla "ECG".
  function ecgBlocks() {
    return [...document.querySelectorAll(".ecg-options")].map((container) => {
      const prefix = container.dataset.prefix || "";
      const editors = container.querySelectorAll(".ecg-editor-label");
      return {
        container,
        prefix,
        incluir: field(named(prefix, "incluirEcg")),
        normal: field(named(prefix, "ecgNormal")),
        frecuencia: field(named(prefix, "ecgFrecuencia")),
        descripcion: field(named(prefix, "ecgDescripcion")),
        normalEditor: editors[0],
        descripcionEditor: editors[1]
      };
    });
  }

  function updateEcgBlocks() {
    ecgBlocks().forEach((ecg) => {
      const on = ecg.incluir.checked;
      const collapsed = !on && "collapse" in ecg.container.dataset;
      ecg.container.classList.toggle("is-disabled", !on);
      ecg.container.classList.toggle("is-collapsed", collapsed);
      ecg.normal.disabled = !on;
      ecg.frecuencia.disabled = !on || !ecg.normal.checked;
      ecg.descripcion.disabled = !on || ecg.normal.checked;
      ecg.normal.closest("label").hidden = collapsed;
      ecg.normalEditor.hidden = collapsed || !ecg.normal.checked;
      ecg.descripcionEditor.hidden = collapsed || ecg.normal.checked;
    });
  }

  // Devuelve el hallazgo anormal de cada signo vital, o "" si está en rango.
  const VITALES_ADULTO = {
    pa(text) {
      // Formato sistólica/diastólica; no se evalúa hasta que ambas estén escritas.
      const match = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (!match) return "";
      const sistolica = Number(match[1]);
      const diastolica = Number(match[2]);
      if (sistolica < 90) return "Hipotensión";
      if (sistolica >= 140 || diastolica >= 90) return "Hipertensión";
      return "";
    },
    fc(text) {
      const [fc] = numbersIn(text);
      if (fc === undefined) return "";
      if (fc < 60) return "Bradicardia";
      if (fc > 100) return "Taquicardia";
      return "";
    },
    fr(text) {
      const [fr] = numbersIn(text);
      if (fr === undefined) return "";
      if (fr < 12) return "Bradipnea";
      if (fr >= 20) return "Polipnea";
      return "";
    },
    sat(text) {
      const [sat] = numbersIn(text);
      if (sat === undefined) return "";
      return sat < 94 ? "Desaturación" : "";
    },
    temp(text) {
      const [temp] = numbersIn(text);
      if (temp === undefined) return "";
      return temp >= 38 ? "Fiebre" : "";
    },
    hgt(text) {
      const [hgt] = numbersIn(text);
      if (hgt === undefined) return "";
      if (hgt < 70) return "Hipoglucemia";
      if (hgt > 180) return "Hiperglucemia";
      return "";
    }
  };

  function updateVitalAlerts() {
    Object.entries(config.vitalChecks || {}).forEach(([name, check]) => {
      const input = field(name);
      if (!input) return;
      let alert = input.parentElement.querySelector(".vital-alert");
      if (!alert) {
        alert = document.createElement("span");
        alert.className = "vital-alert";
        input.after(alert);
      }
      const finding = check(input.value.trim());
      input.classList.toggle("is-abnormal", Boolean(finding));
      alert.textContent = finding;
      alert.hidden = !finding;
    });
  }

  /* ---------- Actualización, borrador y acciones ---------- */

  function update() {
    if (config.onUpdate) config.onUpdate();
    updateVitalAlerts();
    preview.textContent = config.buildHistoria() || "Complete campos a la izquierda para generar la historia clínica.";

    const sinAlergias = field("sinAlergias");
    const alergias = field("alergias");
    if (sinAlergias && alergias) {
      alergias.disabled = sinAlergias.checked;
      if (sinAlergias.checked) alergias.value = "";
    }

    updateEcgBlocks();

    statusEl.textContent = "Actualizado";
    statusEl.className = "status";
    saveDraft();
  }

  function saveDraft() {
    const fields = {};
    form.querySelectorAll("[data-field]").forEach((el) => {
      fields[el.dataset.field] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
    });
    const antecedentes = antecedentesBox
      ? [...antecedentesBox.querySelectorAll(".antecedente-row")].map((row) => ({
        name: row.querySelector(".ap-name").value,
        treatment: row.querySelector(".ap-treatment").value,
        other: row.querySelector(".ap-other").value
      }))
      : [];
    try {
      localStorage.setItem(config.draftKey, JSON.stringify({ savedAt: Date.now(), fields, antecedentes }));
    } catch {}
  }

  function restoreDraft() {
    let draft;
    try {
      draft = JSON.parse(localStorage.getItem(config.draftKey));
    } catch {
      return false;
    }
    if (!draft || !draft.fields || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return false;
    Object.entries(draft.fields).forEach(([name, fieldValue]) => {
      const el = form.querySelector(`[data-field="${name}"]`);
      if (!el) return;
      if (el.type === "checkbox" || el.type === "radio") el.checked = Boolean(fieldValue);
      else el.value = fieldValue;
    });
    if (antecedentesBox) {
      antecedentesBox.innerHTML = "";
      (draft.antecedentes || []).forEach((data) => addAntecedente(data));
      if (!antecedentesBox.children.length) addAntecedente();
    }
    return true;
  }

  async function copyHistoria() {
    const text = config.buildHistoria();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const temp = document.createElement("textarea");
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      temp.remove();
    }
    statusEl.textContent = "Copiado al portapapeles";
    statusEl.className = "status toast";
  }

  function downloadTxt() {
    const text = config.buildHistoria();
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = config.fileName || "historia-clinica.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Vuelve cada campo al valor inicial escrito en el HTML de la página.
  function resetForm() {
    form.reset();
    if (antecedentesBox) {
      antecedentesBox.innerHTML = "";
      addAntecedente();
    }
    update();
  }

  function clearAll() {
    if (!confirm("¿Limpiar todos los campos?")) return;
    resetForm();
  }

  /* ---------- Plantillas ---------- */

  function applyTemplate(name) {
    const template = (config.templates || {})[name];
    if (!template) return;
    resetForm();
    let firstBlank = null;
    Object.entries(template).forEach(([fieldName, fieldValue]) => {
      if (fieldName === "label") return;
      const el = field(fieldName);
      if (!el) return;
      if (el.type === "checkbox" || el.type === "radio") {
        el.checked = fieldValue;
      } else {
        el.value = fieldValue;
        if (!firstBlank && String(fieldValue).includes("___")) firstBlank = el;
      }
    });
    update();
    // Deja seleccionado el primer blanco "___" para completarlo directamente.
    if (firstBlank) {
      const blank = firstBlank.value.indexOf("___");
      firstBlank.focus();
      firstBlank.setSelectionRange(blank, blank + 3);
    }
  }

  /* ---------- Menús desplegables (plantillas y cambio de historia) ---------- */

  const openMenus = [];

  function setupMenu(container, toggle, list) {
    const setOpen = (open) => {
      list.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => setOpen(list.hidden));
    document.addEventListener("click", (event) => {
      if (!container.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !list.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });
    openMenus.push(setOpen);
    return setOpen;
  }

  // Aviso en gris dentro del menú de plantillas.
  function templateNote(text) {
    const note = document.createElement("p");
    note.className = "template-empty";
    note.textContent = text;
    return note;
  }

  function setupTemplateMenu() {
    const container = document.getElementById("templateMenu");
    if (!container) return;
    const entries = Object.entries(config.templates || {});
    const list = document.getElementById("templateList");
    const setOpen = setupMenu(container, document.getElementById("templateToggle"), list);
    if (!entries.length) {
      list.appendChild(templateNote("Próximamente"));
      return;
    }
    entries.forEach(([name, template]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "template-item";
      item.setAttribute("role", "menuitem");
      item.textContent = template.label;
      item.addEventListener("click", () => {
        setOpen(false);
        applyTemplate(name);
      });
      list.appendChild(item);
    });
    if (config.templatesNote) list.appendChild(templateNote(config.templatesNote));
  }

  function setupPageMenu() {
    const container = document.getElementById("pageMenu");
    if (!container) return;
    const list = document.getElementById("pageList");
    setupMenu(container, document.getElementById("pageToggle"), list);
    const current = document.body.dataset.page;
    PAGES.forEach((page) => {
      const item = document.createElement("a");
      item.className = "template-item";
      item.setAttribute("role", "menuitem");
      item.href = page.href;
      item.textContent = page.label;
      if (page.href === current) item.setAttribute("aria-current", "page");
      list.appendChild(item);
    });
  }

  /* ---------- Editor ampliado para campos de una línea que desbordan ---------- */

  let expandedEditor = null;

  function closeExpandedEditor() {
    if (!expandedEditor) return;
    // Quitar el editor dispara su "blur", que vuelve a llamar a esta función: se suelta la
    // referencia antes para que esa segunda llamada no intente quitarlo otra vez.
    const editor = expandedEditor;
    expandedEditor = null;
    editor.remove();
  }

  function openExpandedEditor(input, keepCaret = false) {
    if (expandedEditor?.source === input) return;
    closeExpandedEditor();
    // Posición del cursor en el campo original (null en tipos que no la soportan, p. ej. number)
    let caretStart = null;
    let caretEnd = null;
    if (keepCaret) {
      try {
        caretStart = input.selectionStart;
        caretEnd = input.selectionEnd;
      } catch (error) {
        caretStart = caretEnd = null;
      }
    }
    const editor = document.createElement("textarea");
    const rect = input.getBoundingClientRect();
    editor.className = "expanded-editor";
    editor.value = input.value;
    editor.placeholder = input.placeholder;
    editor.source = input;
    const editorWidth = Math.min(520, window.innerWidth - 24);
    editor.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - editorWidth - 12))}px`;
    editor.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 132)}px`;
    editor.addEventListener("input", () => {
      input.value = editor.value.replace(/\n+/g, " ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    editor.addEventListener("blur", closeExpandedEditor);
    document.body.appendChild(editor);
    expandedEditor = editor;
    editor.focus();
    if (caretStart === null || caretEnd === null) {
      caretStart = caretEnd = editor.value.length;
    }
    editor.setSelectionRange(caretStart, caretEnd);
  }

  const TEXT_INPUT = "input:not([type='checkbox']):not([type='radio'])";

  function showReminder(text) {
    const toast = document.createElement("div");
    toast.className = "reminder-toast";
    toast.setAttribute("role", "status");
    toast.textContent = text;
    document.body.appendChild(toast);
    toast.getBoundingClientRect(); // fuerza el estilo inicial para que se anime la entrada
    toast.classList.add("is-visible");
    setTimeout(() => {
      toast.classList.remove("is-visible");
      toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 5000);
  }

  /* ---------- Inicio ---------- */

  // options: { draftKey, fileName, buildHistoria, templates, templatesNote, vitalChecks, antecedentePlaceholders, onUpdate }
  function init(options) {
    config = options;
    form = document.getElementById("hcForm");
    preview = document.getElementById("historia");
    statusEl = document.getElementById("status");
    antecedentesBox = document.getElementById("antecedentes");

    form.addEventListener("focusin", (event) => {
      const input = event.target;
      if (expandedEditor && input !== expandedEditor && input !== expandedEditor.source) closeExpandedEditor();
      if (input.matches(TEXT_INPUT) && input.scrollWidth > input.clientWidth) openExpandedEditor(input);
    });

    form.addEventListener("input", (event) => {
      const input = event.target;
      if (input.matches(TEXT_INPUT) && input.scrollWidth > input.clientWidth) openExpandedEditor(input, true);
    });

    ecgBlocks().forEach((ecg) => {
      ecg.incluir.addEventListener("change", () => {
        if (ecg.incluir.checked) ecg.normal.checked = true;
        update();
      });
      ecg.normal.addEventListener("change", () => {
        if (!ecg.normal.checked && !ecg.descripcion.value.trim()) ecg.descripcion.value = ecgNormalDescripcion(ecg.prefix);
        update();
      });
    });

    document.getElementById("copyTop").addEventListener("click", copyHistoria);
    document.getElementById("downloadTxt").addEventListener("click", downloadTxt);
    document.getElementById("clearAll").addEventListener("click", clearAll);
    setupTemplateMenu();
    setupPageMenu();

    const addButton = document.getElementById("addAntecedente");
    if (addButton) {
      addButton.addEventListener("click", () => {
        addAntecedente().querySelector(".ap-name").focus();
        update();
      });
    }

    form.addEventListener("input", update);
    form.addEventListener("change", update);

    // Texto de la página vacía, para avisar solo si el borrador restaurado tiene datos.
    const emptyHistoria = config.buildHistoria();
    if (!restoreDraft() && antecedentesBox) addAntecedente();
    update();
    if (config.buildHistoria() !== emptyHistoria) {
      showReminder("Recordá limpiar la página antes de iniciar con un nuevo paciente");
    }
  }

  return {
    init,
    value,
    endDot,
    sentence,
    line,
    lines,
    bullets,
    fieldOrNormal,
    edadTexto,
    numbersIn,
    antecedentesItems,
    antecedentesTexto,
    alergiaItems,
    examenAdulto,
    ecgTexto,
    VITALES_ADULTO
  };
})();
