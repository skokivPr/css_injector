let inputEditor, outputEditor;
let detectedMatches = [];
let selectedMatchId = -1;
let currentSelectionDecorations = [];
let appliedDecorations = [];

const systemVars = [
    'var(--bg-color)', 'var(--border-color)', 'var(--border-color-hover)', 'var(--highlight-color)',
    'var(--success-color)', 'var(--bg)', 'var(--bg-primary)', 'var(--bg-secondary)', 'var(--bg-tertiary)',
    'var(--panel-bg)', 'var(--card-bg)', 'var(--text-color)', 'var(--text-primary)', 'var(--text-muted)',
    'var(--hover-bg)', 'var(--shadow-drop)', 'var(--shadow-inset)', 'var(--shadow-hover)'
];

const varLibrary = {
    color: ['var(--text-color)', 'var(--text-muted)', 'var(--text-primary)', 'var(--text-inverse)'],
    background: ['var(--bg-tertiary)', 'var(--hover-bg)', 'var(--bg-primary)', 'var(--panel-bg)', 'var(--bg-color)'],
    border: ['var(--border-color)', 'var(--border-color-hover)'],
    shadow: ['var(--shadow-drop)', 'var(--shadow-inset)', 'var(--shadow-hover)']
};

const ThemeManager = {
    save: (t) => localStorage.setItem('cyber-refactor-theme', t),
    load: () => localStorage.getItem('cyber-refactor-theme') || 'light',
    apply: (t) => {
        document.documentElement.setAttribute('theme', t === 'dark' ? 'dark' : '');
        ThemeManager.save(t);
        if (window.monaco) monaco.editor.setTheme(t === 'dark' ? 'terminal-dark' : 'terminal-light');
        if (window.MonacoEditorSettings) window.MonacoEditorSettings.applyEditorOptions();
    }
};

MonacoEditorSettings.loadSettings();

const SIDEBAR_STORAGE_KEY = 'cyber-refactor-sidebar-width';
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 720;
const SNAP_POINTS = [280, 320, 400, 480, 560];
const SNAP_THRESHOLD = 14;

function getSidebarWidth() {
    const container = document.querySelector('.main-container');
    const raw = container ? getComputedStyle(container).getPropertyValue('--sidebar-width').trim() : '';
    const px = parseInt(raw, 10);
    return isNaN(px) ? 400 : Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, px));
}

function setSidebarWidth(px) {
    const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, px));
    document.querySelector('.main-container').style.setProperty('--sidebar-width', w + 'px');
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(w));
}

function snapToMagnetic(px) {
    for (const point of SNAP_POINTS) {
        if (Math.abs(px - point) <= SNAP_THRESHOLD) return point;
    }
    return px;
}

function initResizeHandles() {
    const container = document.querySelector('.main-container');
    const sidebar = document.getElementById('sidebarCol');
    const gutterLeft = document.getElementById('gutterLeft');
    const gutterRight = document.getElementById('gutterRight');
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
        const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parseInt(saved, 10)));
        if (!isNaN(w)) container.style.setProperty('--sidebar-width', w + 'px');
    }

    function startDrag(side) {
        gutterLeft.classList.toggle('resizing', true);
        gutterRight.classList.toggle('resizing', true);
        function move(e) {
            const cr = container.getBoundingClientRect();
            const sr = sidebar.getBoundingClientRect();
            let w;
            if (side === 'left') w = sr.right - e.clientX;
            else w = e.clientX - sr.left;
            w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w));
            w = snapToMagnetic(w);
            setSidebarWidth(w);
        }
        function stop() {
            const w = snapToMagnetic(getSidebarWidth());
            setSidebarWidth(w);
            gutterLeft.classList.remove('resizing');
            gutterRight.classList.remove('resizing');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
            if (inputEditor) inputEditor.layout();
            if (outputEditor) outputEditor.layout();
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
    }

    gutterLeft.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag('left'); });
    gutterRight.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag('right'); });
}

document.addEventListener('DOMContentLoaded', initResizeHandles);

require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
require(['vs/editor/editor.main'], function () {
    if (window.defineMonacoThemes) defineMonacoThemes();
    ThemeManager.apply(ThemeManager.load());

    const options = {
        language: 'css',
        ...MonacoEditorSettings.getEditorOptions(),
        value: ''
    };

    inputEditor = monaco.editor.create(document.getElementById('inputEditor'), {
        ...options,
        value: `.btn {\n  background: #ffffff;\n  color: #6c757d;\n  border: 1px solid #dee2e6;\n}\n\n.btn:hover {\n  background: rgba(0,0,0,0.05);\n  color: #212529;\n}`
    });

    outputEditor = monaco.editor.create(document.getElementById('outputEditor'), {
        ...options,
        value: ''
    });

    MonacoEditorSettings.setEditors(inputEditor, outputEditor);

    // Event: Selection Change in Workbench
    outputEditor.onDidChangeCursorSelection((e) => {
        handleSelectionChange(e);
    });

    loadSourceToWorkbench();
});

function handleSelectionChange(e) {
    const selection = outputEditor.getSelection();
    const selectedText = outputEditor.getModel().getValueInRange(selection);
    const contextPanel = document.getElementById('selectionContext');
    const selectionType = document.getElementById('selectionType');
    const selectionVars = document.getElementById('selectionVars');

    if (!selectedText || selectedText.trim().length === 0) {
        contextPanel.style.display = 'none';
        return;
    }

    // Get full line to determine property
    const lineContent = outputEditor.getModel().getLineContent(selection.startLineNumber);
    contextPanel.style.display = 'block';

    let type = 'general';
    if (lineContent.includes('color')) type = 'color';
    if (lineContent.includes('background')) type = 'background';
    if (lineContent.includes('border')) type = 'border';
    if (lineContent.includes('shadow')) type = 'shadow';

    selectionType.innerText = `CONTEXT: ${type.toUpperCase()}`;

    // Populate relevant variables
    selectionVars.innerHTML = '';
    const targets = varLibrary[type] || Object.values(varLibrary).flat();

    [...new Set(targets)].forEach(v => {
        const btn = document.createElement('button');
        btn.className = 'var-btn';
        btn.innerText = v.replace('var(--', '').replace(')', '');
        btn.onclick = () => injectAtSelection(v);
        selectionVars.appendChild(btn);
    });
}

function injectAtSelection(varName) {
    const selection = outputEditor.getSelection();
    outputEditor.executeEdits('selection-inject', [{
        range: selection,
        text: varName,
        forceMoveMarkers: true
    }]);
    setTimeout(refreshScanner, 100);
}

function loadSourceToWorkbench() {
    if (!inputEditor || !outputEditor) return;
    outputEditor.setValue(inputEditor.getValue());
    refreshScanner();
}

function refreshScanner() {
    if (!outputEditor) return;
    const css = outputEditor.getValue();
    const regex = /(border(?:-bottom|-top|-left|-right|-color)?|background(?:-color)?|box-shadow|color)\s*:\s*([^;]+);/gi;

    detectedMatches = [];
    const listContainer = document.getElementById('detectedList');
    listContainer.innerHTML = '';

    let match;
    let counter = 0;
    let occurrences = {};

    while ((match = regex.exec(css)) !== null) {
        const prop = match[1].toLowerCase().trim();
        const val = match[2].trim();
        const fullLine = match[0];

        if (!systemVars.includes(val)) {
            const preText = css.substring(0, match.index);
            const lastBraceIndex = preText.lastIndexOf('{');
            const lastBlockStart = preText.lastIndexOf('}', lastBraceIndex);
            const selector = preText.substring(lastBlockStart + 1, lastBraceIndex).trim();

            occurrences[fullLine] = (occurrences[fullLine] || 0) + 1;
            const canAutoInject = true;

            const matchData = {
                full: fullLine, prop, val, id: counter,
                occurrenceIndex: occurrences[fullLine] - 1,
                selector: selector
            };
            detectedMatches.push(matchData);

            const div = document.createElement('div');
            div.className = 'detected-row auto-ready';
            div.innerHTML = `<div><span style="opacity:0.5; font-size:0.6rem">${selector}</span><br><strong>${prop}</strong>: ${val}</div>`;
            div.onclick = () => selectInEditor(matchData);
            div.dataset.id = counter;
            listContainer.appendChild(div);
            counter++;
        }
    }
    document.getElementById('footerLog').innerText = `IDENTIFIED: ${counter}`;
}

function selectInEditor(match) {
    const model = outputEditor.getModel();
    const matches = model.findMatches(match.full, false, false, true, null, true);
    const targetMatch = matches[match.occurrenceIndex];

    if (targetMatch) {
        outputEditor.setSelection(targetMatch.range);
        outputEditor.revealRangeInCenter(targetMatch.range, monaco.editor.ScrollType.Smooth);

        currentSelectionDecorations = outputEditor.deltaDecorations(currentSelectionDecorations, [
            { range: targetMatch.range, options: { isWholeLine: true, className: 'monaco-line-highlight' } }
        ]);
    }
}

function runSmartAutoRefactor() {
    if (!outputEditor) return;
    const model = outputEditor.getModel();
    const edits = [];
    let count = 0;

    detectedMatches.forEach(match => {
        let targetVar = null;
        const isHover = match.selector.includes(':hover');
        if (match.prop.startsWith('border')) targetVar = 'var(--border-color)';
        else if (match.prop === 'color') targetVar = isHover ? 'var(--text-color)' : 'var(--text-muted)';
        else if (match.prop.startsWith('background')) targetVar = isHover ? 'var(--hover-bg)' : 'var(--bg-tertiary)';
        else if (match.prop === 'box-shadow') targetVar = match.selector.includes(':active') ? 'var(--shadow-inset)' : 'var(--shadow-drop)';

        if (targetVar) {
            const matches = model.findMatches(match.full, false, false, true, null, true);
            const targetRange = matches[match.occurrenceIndex];
            if (targetRange) {
                edits.push({ range: targetRange.range, text: `${match.prop}: ${targetVar};` });
                count++;
            }
        }
    });

    if (edits.length > 0) {
        outputEditor.executeEdits('smart-auto-map', edits);
        setTimeout(refreshScanner, 100);
    }
}

function applyVar(varName) {
    // Fallback to manual selection if no row selected
    const selection = outputEditor.getSelection();
    if (!selection.isEmpty()) {
        injectAtSelection(varName);
        return;
    }

    // Row logic if needed...
}

document.getElementById('themeToggle').onclick = () => ThemeManager.apply(ThemeManager.load() === 'dark' ? 'light' : 'dark');

document.getElementById('copyBtn').onclick = () => {
    const val = outputEditor.getValue();
    const textArea = document.createElement("textarea");
    textArea.value = val; document.body.appendChild(textArea);
    textArea.select(); document.execCommand('copy'); document.body.removeChild(textArea);
    const btn = document.getElementById('copyBtn'); btn.innerText = '[SYNCED]';
    setTimeout(() => btn.innerText = '[EXTRACT_CODE]', 2000);
};