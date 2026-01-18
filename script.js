// --- Configuration & State ---
const MAX_CANVAS_WIDTH = 512; 
let iconWidth = 16;
let iconHeight = 16;
let pixelSize = MAX_CANVAS_WIDTH / iconWidth; 

let frames = []; // Array of { name: string, layers: Layer[] }
let currentFrameIndex = 0;
let activeLayerIndex = 0;
let currentTool = 'pencil';

let isDrawing = false; 
let drawingState = 1; // 1 for drawing, 0 for erasing

let startX = -1, startY = -1; 
let previewPixels = null; // Temporary grid for shape previews
let layerSnapshot = null; // Snapshot for move operations
let parsedGrid = null;

let isPlaying = false;
let animationSpeed = 250; 
let lastTimestamp = 0;
let animationFrameId = null; 
let currentAnimationFrame = null;
let animationFrame = 0;

// Tool definitions - Expanded Set
const TOOLS = [
    { id: 'pencil', name: 'Pencil', icon: '✏️', cursor: 'crosshair' },
    { id: 'eraser', name: 'Eraser', icon: '🧼', cursor: 'cell' },
    { id: 'line', name: 'Line', icon: '📏', cursor: 'crosshair' },
    { id: 'rectangle', name: 'Rectangle', icon: '⬜', cursor: 'crosshair' },
    { id: 'circle', name: 'Circle', icon: '⭕', cursor: 'crosshair' },
    { id: 'move', name: 'Move', icon: '✥', cursor: 'move' },
    { id: 'fill', name: 'Fill Bucket', icon: '🪣', cursor: 'cell' },
];

const SHAPE_TOOLS = ['line', 'rectangle', 'circle'];
const SIMPLE_TOOLS = ['pencil', 'eraser', 'fill'];

// --- DOM Elements ---
const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');
const playerCanvas = document.getElementById('playerCanvas');
const playerCtx = playerCanvas.getContext('2d');
const byteOutputDiv = document.getElementById('byteOutput');
const dimsText = document.getElementById('dimsText');
const inputWidth = document.getElementById('iconWidth');
const inputHeight = document.getElementById('iconHeight');
const layerListDiv = document.getElementById('layerList');
const frameListDiv = document.getElementById('frameList');
const toolPanelDiv = document.getElementById('toolPanel');
const activeLayerNameSpan = document.getElementById('activeLayerName');
const currentFrameNumSpan = document.getElementById('currentFrameNum');
const totalFramesCountSpan = document.getElementById('totalFramesCount');
const singleFrameByteCountSpan = document.getElementById('singleFrameByteCount');
const animationByteCountSpan = document.getElementById('animationByteCount');

// Animation Player Elements
const playStopBtn = document.getElementById('playStopBtn');
const nextFrameBtn = document.getElementById('nextFrameBtn');
const prevFrameBtn = document.getElementById('prevFrameBtn');
const speedInput = document.getElementById('speedInput');
const playerCurrentFrameSpan = document.getElementById('playerCurrentFrame');
const playerTotalFramesSpan = document.getElementById('playerTotalFrames');

// Export/Import
const generateSingleFrameBtn = document.getElementById('generateSingleFrameBtn');
const generateAnimationBtn = document.getElementById('generateAnimationBtn');
const outputContainer = document.getElementById('outputContainer');
const copyOutputBtn = document.getElementById('copyOutputBtn');
const exportCFileBtn = document.getElementById('exportCFileBtn');
const importModal = document.getElementById('importModal');
const arrayInput = document.getElementById('arrayInput');
const previewCanvas = document.getElementById('previewCanvas');
const previewCtx = previewCanvas.getContext('2d');
const previewArrayBtn = document.getElementById('previewArrayBtn');
const commitImportBtn = document.getElementById('commitImportBtn');
const cancelImportBtn = document.getElementById('cancelImportBtn');
const previewDimsSpan = document.getElementById('previewDims');
const previewBytesSpan = document.getElementById('previewBytes');
const previewErrorP = document.getElementById('previewError');
const mainImportBtn = document.getElementById('importBtn');

// Frame Buttons
const duplicateFrameBtn = document.getElementById('duplicateFrameBtn');
const blankFrameBtn = document.getElementById('blankFrameBtn');
const moveFrameUpBtn = document.getElementById('moveFrameUpBtn');
const moveFrameDownBtn = document.getElementById('moveFrameDownBtn');

// --- Core State Accessors ---
function getActiveLayers() {
    return frames[currentFrameIndex].layers;
}
function getActiveFrame() {
    return frames[currentFrameIndex];
}

// --- Utility Functions ---
function createBlankGrid(w, h) {
    return Array.from({ length: h }, () => Array(w).fill(0));
}

function getPixelCoords(e) { 
    // Fix: Always use the gridCanvas for coordinate calculation relative to the drawing area
    // even if the event target is the document (mouse up outside canvas)
    const rect = canvas.getBoundingClientRect(); 
    let clientX, clientY;
    
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        // Handle touchend which has changedTouches but not touches
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const x = Math.floor(((clientX - rect.left) / rect.width) * iconWidth);
    const y = Math.floor(((clientY - rect.top) / rect.height) * iconHeight);
    return { x, y };
}

function setPixel(grid, x, y, value) {
    if (x >= 0 && x < iconWidth && y >= 0 && y < iconHeight) {
        grid[y][x] = value;
    }
}

// --- Drawing Algorithms ---
function drawLine(grid, x0, y0, x1, y1, value) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;
    while (true) {
        setPixel(grid, x0, y0, value);
        if ((x0 === x1) && (y0 === y1)) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

function drawRectangle(grid, x0, y0, x1, y1, value) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            setPixel(grid, x, y, value);
        }
    }
}

function drawCircle(grid, x0, y0, x1, y1, value) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const radius = Math.round(Math.sqrt(dx * dx + dy * dy));
    let x = radius;
    let y = 0;
    let err = 0;
    while (x >= y) {
        for (let i = x0 - x; i <= x0 + x; i++) { setPixel(grid, i, y0 + y, value); setPixel(grid, i, y0 - y, value); }
        for (let i = x0 - y; i <= x0 + y; i++) { setPixel(grid, i, y0 + x, value); setPixel(grid, i, y0 - x, value); }
        if (err <= 0) { y += 1; err += 2 * y + 1; }
        if (err > 0) { x -= 1; err -= 2 * x + 1; }
    }
}

function floodFill(x, y) {
    const targetGrid = getActiveLayers()[activeLayerIndex].data;
    const targetValue = targetGrid[y][x];
    const newValue = drawingState; 
    if (targetValue === newValue) return;
    const queue = [[x, y]];
    while(queue.length > 0) {
        const [cx, cy] = queue.shift();
        if (cx >= 0 && cx < iconWidth && cy >= 0 && cy < iconHeight && targetGrid[cy][cx] === targetValue) {
            targetGrid[cy][cx] = newValue;
            queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }
    }
}

function shiftGrid(sourceGrid, offsetX, offsetY) {
    const targetGrid = createBlankGrid(iconWidth, iconHeight);
    for (let y = 0; y < iconHeight; y++) {
        for (let x = 0; x < iconWidth; x++) {
            const newX = x + offsetX;
            const newY = y + offsetY;
            if (newX >= 0 && newX < iconWidth && newY >= 0 && newY < iconHeight) {
                targetGrid[newY][newX] = sourceGrid[y][x];
            }
        }
    }
    return targetGrid;
}

// --- Canvas Rendering ---
function drawScene(targetCtx, targetCanvas, targetPixelSize, layersToRender) {
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.strokeStyle = '#bdbdbd'; 

    // 1. Onion Skinning (Previous Frame) - Only on Editor
    if (targetCanvas.id === 'gridCanvas' && frames.length > 1 && currentFrameIndex > 0) {
        const prevFrameIndex = (currentFrameIndex - 1);
        const prevFrameLayers = frames[prevFrameIndex].layers;
        const prevComposite = mergeVisibleLayers(prevFrameLayers);
        targetCtx.fillStyle = 'rgba(0, 0, 0, 0.1)'; 
        for (let y = 0; y < iconHeight; y++) {
            for (let x = 0; x < iconWidth; x++) {
                if (prevComposite[y][x]) {
                    targetCtx.fillRect(x * targetPixelSize, y * targetPixelSize, targetPixelSize, targetPixelSize);
                }
            }
        }
    }
    
    // 2. Current Frame Layers
    for (let k = 0; k < layersToRender.length; k++) {
        const layer = layersToRender[k];
        if (!layer.visible) continue;
        targetCtx.fillStyle = '#000000'; 
        for (let y = 0; y < iconHeight; y++) {
            for (let x = 0; x < iconWidth; x++) {
                if (layer.data[y][x]) {
                    targetCtx.fillRect(x * targetPixelSize, y * targetPixelSize, targetPixelSize, targetPixelSize);
                }
            }
        }
    }

    // 3. Editor Overlays (Preview & Grid)
    if (targetCanvas.id === 'gridCanvas') {
        // Preview Pixels (Shapes/Move)
        if (previewPixels) {
            targetCtx.fillStyle = '#f59e0b'; // Amber for preview
            for (let y = 0; y < iconHeight; y++) {
                for (let x = 0; x < iconWidth; x++) {
                    if (previewPixels[y][x]) {
                        targetCtx.fillRect(x * targetPixelSize, y * targetPixelSize, targetPixelSize, targetPixelSize);
                    }
                }
            }
        }
        
        // Grid Lines
        targetCtx.strokeStyle = '#bdbdbd'; 
        for (let y = 0; y <= iconHeight; y++) {
            targetCtx.beginPath();
            targetCtx.moveTo(0, y * targetPixelSize);
            targetCtx.lineTo(targetCanvas.width, y * targetPixelSize);
            targetCtx.stroke();
        }
        for (let x = 0; x <= iconWidth; x++) {
            targetCtx.beginPath();
            targetCtx.moveTo(x * targetPixelSize, 0);
            targetCtx.lineTo(x * targetPixelSize, targetCanvas.height);
            targetCtx.stroke();
        }
    }
}

// --- Interaction Handlers ---

function commitPreview(finalX, finalY) {
    if (!previewPixels && currentTool !== 'move') return;

    const activeLayer = getActiveLayers()[activeLayerIndex];
    const targetGrid = activeLayer.data;
    
    if (SHAPE_TOOLS.includes(currentTool)) {
        // Apply shape to actual layer
        // We use drawingState (1 usually, could be 0)
        const value = 1; 
        if (currentTool === 'line') drawLine(targetGrid, startX, startY, finalX, finalY, value);
        else if (currentTool === 'rectangle') drawRectangle(targetGrid, startX, startY, finalX, finalY, value);
        else if (currentTool === 'circle') drawCircle(targetGrid, startX, startY, finalX, finalY, value);
    } else if (currentTool === 'move') {
        const offsetX = finalX - startX;
        const offsetY = finalY - startY;
        activeLayer.data = shiftGrid(layerSnapshot, offsetX, offsetY);
        layerSnapshot = null;
    }

    previewPixels = null; 
}

function handleStart(e) {
    e.preventDefault();
    if (frames.length === 0 || document.getElementById('editor').classList.contains('hidden')) return;
    isDrawing = true;
    const { x, y } = getPixelCoords(e);
    startX = x; startY = y;
    drawingState = (currentTool === 'eraser' ? 0 : 1); 
    
    const activeLayer = getActiveLayers()[activeLayerIndex];

    if (SIMPLE_TOOLS.includes(currentTool)) {
        if (currentTool === 'fill') {
            floodFill(x, y);
            isDrawing = false; 
        } else {
            setPixel(activeLayer.data, x, y, drawingState); 
        }
    } else if (currentTool === 'move') {
        layerSnapshot = JSON.parse(JSON.stringify(activeLayer.data));
        activeLayer.data = createBlankGrid(iconWidth, iconHeight);
    } else if (SHAPE_TOOLS.includes(currentTool)) {
        previewPixels = createBlankGrid(iconWidth, iconHeight);
    }

    updateUI();
}

function handleMove(e) {
    e.preventDefault();
    if (!isDrawing || frames.length === 0) return;
    const { x, y } = getPixelCoords(e);
    const activeLayer = getActiveLayers()[activeLayerIndex];

    if (currentTool === 'pencil' || currentTool === 'eraser') {
        drawLine(activeLayer.data, startX, startY, x, y, drawingState);
        startX = x; startY = y;
    } else if (SHAPE_TOOLS.includes(currentTool)) {
        previewPixels = createBlankGrid(iconWidth, iconHeight);
        drawPreviewShape(previewPixels, x, y);
    } else if (currentTool === 'move') {
        const offsetX = x - startX;
        const offsetY = y - startY;
        previewPixels = shiftGrid(layerSnapshot, offsetX, offsetY);
    }
    updateUI();
}

function handleEnd(e) {
    if (!isDrawing || frames.length === 0) return;
    isDrawing = false;
    const { x, y } = getPixelCoords(e);

    if (SHAPE_TOOLS.includes(currentTool) || currentTool === 'move') {
        commitPreview(x, y);
    }
    
    startX = -1; startY = -1;
    updateUI();
}

function drawPreviewShape(grid, targetX, targetY) {
    const value = 1;
    if (currentTool === 'line') drawLine(grid, startX, startY, targetX, targetY, value);
    else if (currentTool === 'rectangle') drawRectangle(grid, startX, startY, targetX, targetY, value);
    else if (currentTool === 'circle') drawCircle(grid, startX, startY, targetX, targetY, value);
}

// --- Core Application Logic (Frames/Layers/Export) ---
// (Mostly identical to original, ensuring references are correct)

function moveFrame(direction) {
    const oldIndex = currentFrameIndex;
    const newIndex = oldIndex + direction;
    if (newIndex >= 0 && newIndex < frames.length) {
        const frameToMove = frames.splice(oldIndex, 1)[0];
        frames.splice(newIndex, 0, frameToMove);
        selectFrame(newIndex);
    }
}

function addFrame(isDuplicate = false) {
    const newFrameIndex = frames.length;
    let newLayers = [];
    if (isDuplicate && frames.length > 0) {
        const activeLayers = getActiveLayers();
        newLayers = activeLayers.map(layer => ({
            name: layer.name,
            visible: layer.visible,
            data: JSON.parse(JSON.stringify(layer.data))
        }));
    } else {
        newLayers = [{
            name: 'Base Layer',
            data: createBlankGrid(iconWidth, iconHeight),
            visible: true,
        }];
    }
    frames.push({ name: `Frame ${newFrameIndex + 1}`, layers: newLayers });
    selectFrame(newFrameIndex);
}

function selectFrame(index) {
    if (index < 0 || index >= frames.length) return;
    currentFrameIndex = index;
    activeLayerIndex = Math.min(activeLayerIndex, getActiveLayers().length - 1);
    outputContainer.classList.add('hidden'); 
    renderFrameList();
    renderLayerList();
    updateUI();
}

function removeFrame(index) {
    if (frames.length > 1) {
        frames.splice(index, 1);
        if (currentFrameIndex >= index) currentFrameIndex = Math.max(0, currentFrameIndex - 1);
        selectFrame(currentFrameIndex); 
    }
}

function renderFrameList() {
    frameListDiv.innerHTML = '';
    frames.forEach((frame, index) => {
        const item = document.createElement('div');
        item.className = `item flex items-center justify-between p-2 cursor-pointer transition duration-100 ${index === currentFrameIndex ? 'active' : ''}`;
        item.innerHTML = `
            <div class="flex items-center space-x-2 w-full">
                <span class="frame-name flex-1 text-sm font-medium truncate text-stone-100">${frame.name} (#${index + 1}) ${index === currentFrameIndex ? '<span class="text-accent">(Active)</span>' : ''}</span>
            </div>
            <button class="delete-frame ml-2 p-1 text-sm text-red-500 rounded-md hover:bg-red-900" data-index="${index}" title="Delete Frame" ${frames.length === 1 ? 'disabled' : ''}>${frames.length === 1 ? '🔒' : '❌'}</button>
        `;
        item.addEventListener('click', () => selectFrame(index));
        item.querySelector('.delete-frame').addEventListener('click', (e) => { e.stopPropagation(); removeFrame(index); });
        frameListDiv.appendChild(item);
    });
    currentFrameNumSpan.textContent = currentFrameIndex + 1;
    totalFramesCountSpan.textContent = frames.length;
    playerTotalFramesSpan.textContent = frames.length;
    playerCurrentFrameSpan.textContent = (isPlaying ? frames.indexOf(currentAnimationFrame) : currentFrameIndex) + 1;
    moveFrameUpBtn.disabled = currentFrameIndex === 0;
    moveFrameDownBtn.disabled = currentFrameIndex === frames.length - 1;
    updateExportBytes();
}

function createNewLayer(name = `Layer ${getActiveLayers().length + 1}`, setActive = true) {
    const layers = getActiveLayers();
    layers.push({ name: name, data: createBlankGrid(iconWidth, iconHeight), visible: true });
    if (setActive) activeLayerIndex = layers.length - 1;
    renderLayerList();
    updateUI();
}

function renderLayerList() {
    const layers = getActiveLayers();
    layerListDiv.innerHTML = '';
    if (layers.length === 0) {
        layerListDiv.innerHTML = '<p class="text-stone-500 text-sm p-2">No layers. Add a new layer.</p>';
        activeLayerNameSpan.textContent = 'None';
        return;
    }
    layers.slice().reverse().forEach((layer, originalIndex) => {
        const index = layers.length - 1 - originalIndex;
        const item = document.createElement('div');
        item.className = `item flex items-center justify-between p-2 cursor-pointer transition duration-100 ${index === activeLayerIndex ? 'active' : ''}`;
        item.innerHTML = `
            <div class="flex items-center space-x-2 w-full text-stone-100">
                <button class="toggle-visibility p-1 text-sm rounded-md hover:bg-stone-600" title="Toggle Visibility">${layer.visible ? '👁️' : '🚫'}</button>
                <span class="layer-name flex-1 text-sm font-medium truncate">${layer.name} ${index === activeLayerIndex ? '<span class="text-accent">(Active)</span>' : ''}</span>
                <button class="edit-name p-1 text-sm rounded-md hover:bg-stone-600" title="Edit Name">✏️</button>
            </div>
            <button class="delete-layer ml-2 p-1 text-sm text-red-500 rounded-md hover:bg-red-900" title="Delete Layer" ${layers.length === 1 ? 'disabled' : ''}>${layers.length === 1 ? '🔒' : '❌'}</button>
        `;
        item.addEventListener('click', () => setActiveLayer(index));
        item.querySelector('.toggle-visibility').addEventListener('click', (e) => { e.stopPropagation(); layers[index].visible = !layers[index].visible; renderLayerList(); updateUI(); });
        item.querySelector('.delete-layer').addEventListener('click', (e) => { e.stopPropagation(); if (layers.length > 1) { layers.splice(index, 1); if (activeLayerIndex >= index && activeLayerIndex > 0) activeLayerIndex--; renderLayerList(); updateUI(); }});
        item.querySelector('.edit-name').addEventListener('click', (e) => { e.stopPropagation(); const newName = prompt(`Enter new name for Layer ${index + 1}:`, layer.name); if (newName && newName.trim() !== '') { layers[index].name = newName.trim(); renderLayerList(); }});
        layerListDiv.appendChild(item);
    });
    if (layers.length > 0) activeLayerNameSpan.textContent = layers[activeLayerIndex].name;
}

function setActiveLayer(index) {
    activeLayerIndex = index;
    renderLayerList();
}

function updateExportBytes() {
    const frameBytes = generateBitmapBytes(mergeVisibleLayers(getActiveLayers()));
    const singleSize = frameBytes.length;
    const animationSize = frames.reduce((sum, frame) => sum + generateBitmapBytes(mergeVisibleLayers(frame.layers)).length, 0);
    singleFrameByteCountSpan.textContent = singleSize;
    animationByteCountSpan.textContent = animationSize;
}

function updateUI() {
    if (frames.length === 0) return;
    drawScene(ctx, canvas, pixelSize, getActiveLayers());
    dimsText.textContent = `${iconWidth}x${iconHeight}`;
    renderFrameList();
    renderLayerList();
    updateExportBytes();
    if (isPlaying) stopAnimation();
}

function mergeVisibleLayers(layers) {
    const composite = createBlankGrid(iconWidth, iconHeight);
    for (let y = 0; y < iconHeight; y++) {
        for (let x = 0; x < iconWidth; x++) {
            for (const layer of layers) {
                if (layer.visible && layer.data[y][x] === 1) {
                    composite[y][x] = 1;
                    break; 
                }
            }
        }
    }
    return composite;
}

function generateBitmapBytes(compositeGrid) {
    const h_banks = Math.ceil(iconWidth / 8); 
    const byte_array = [];
    for (let y = 0; y < iconHeight; y++) { 
        for (let h_bank = 0; h_bank < h_banks; h_bank++) {
            let current_byte = 0x00;
            const start_x = h_bank * 8; 
            for (let bit_col = 0; bit_col < 8; bit_col++) {
                const x_bit = start_x + bit_col;
                if (x_bit < iconWidth) {
                    if (compositeGrid[y][x_bit]) current_byte |= (1 << bit_col);
                }
            }
            byte_array.push(current_byte);
        }
    }
    return byte_array;
}

function formatBytes(byte_array, name) {
    let output = `// Frame: ${name} (${iconWidth}x${iconHeight}). Total Bytes: ${byte_array.length}\n`;
    output += `const uint8_t FRAME_BITMAP[${byte_array.length}] = {\n    `;
    for (let i = 0; i < byte_array.length; i++) {
        output += '0x' + byte_array[i].toString(16).toUpperCase().padStart(2, '0');
        if (i < byte_array.length - 1) output += ', ';
        if ((i + 1) % 8 === 0 && i < byte_array.length - 1) output += '\n    ';
    }
    output += '\n};';
    return output;
}

function formatAnimationBytes(animationBytes) {
    const bytesPerFrame = animationBytes.length > 0 ? animationBytes[0].length : 0;
    let output = `// Animation Frames: ${frames.length} frames of ${iconWidth}x${iconHeight}.\n`;
    output += `// Total Data Size: ${frames.length * bytesPerFrame} bytes.\n`;
    output += `const uint8_t ANIMATION_BITMAPS[${frames.length}][${bytesPerFrame}] = {\n`;
    animationBytes.forEach((frameBytes, i) => {
        output += `    // Frame ${i}: ${frames[i].name}\n    { `;
        for (let j = 0; j < frameBytes.length; j++) {
            output += '0x' + frameBytes[j].toString(16).toUpperCase().padStart(2, '0');
            if (j < frameBytes.length - 1) output += ', ';
            if ((j + 1) % 8 === 0 && j < frameBytes.length - 1) output += '\n      ';
        }
        output += ` }${i < animationBytes.length - 1 ? ',' : ''}\n`;
    });
    output += `};`;
    return output;
}

function downloadCFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function generateAndDisplayCode(type) {
    if (frames.length === 0) return;
    let outputCode = '';
    let fileName = '';
    if (type === 'single') {
        const frameBytes = generateBitmapBytes(mergeVisibleLayers(getActiveLayers()));
        outputCode = formatBytes(frameBytes, getActiveFrame().name);
        fileName = `${getActiveFrame().name.toLowerCase().replace(/\s/g, '_')}_bitmap.c`;
        generateSingleFrameBtn.textContent = 'Generated!';
        setTimeout(() => generateSingleFrameBtn.textContent = `Generate Single Frame Array (${frameBytes.length} bytes)`, 2000);
    } else if (type === 'animation') {
        const allAnimationBytes = frames.map(frame => generateBitmapBytes(mergeVisibleLayers(frame.layers)));
        outputCode = formatAnimationBytes(allAnimationBytes);
        fileName = `animation_bitmaps.c`;
        const totalBytes = allAnimationBytes.length * (allAnimationBytes[0]?.length || 0);
        generateAnimationBtn.textContent = 'Generated!';
        setTimeout(() => generateAnimationBtn.textContent = `Generate Animation Array (${totalBytes} bytes)`, 2000);
    }
    byteOutputDiv.textContent = outputCode;
    outputContainer.classList.remove('hidden');
    exportCFileBtn.dataset.code = outputCode;
    exportCFileBtn.dataset.filename = fileName;
}

// --- Import Logic ---
function parseBytes(arrayString) {
    const matches = arrayString.match(/0x[0-9a-fA-F]{1,2}|\d+/g);
    if (!matches) return [];
    return matches.map(m => m.startsWith('0x') ? parseInt(m, 16) : parseInt(m, 10)).filter(n => !isNaN(n) && n >= 0 && n <= 255);
}
function parseCArray(byte_array, width, height) {
    const grid = createBlankGrid(width, height);
    const h_banks = Math.ceil(width / 8);
    if (byte_array.length !== h_banks * height) return null;
    let byte_index = 0;
    for (let y = 0; y < height; y++) {
        for (let h_bank = 0; h_bank < h_banks; h_bank++) {
            const bank_data = byte_array[byte_index++];
            const start_x = h_bank * 8;
            for (let bit_col = 0; bit_col < 8; bit_col++) {
                const x = start_x + bit_col;
                if (x < width) { if (bank_data & (1 << bit_col)) grid[y][x] = 1; }
            }
        }
    }
    return grid;
}
function handlePreview() {
    const inputStr = arrayInput.value;
    const w = iconWidth, h = iconHeight;
    const expectedBytes = Math.ceil(w / 8) * h;
    const bytes = parseBytes(inputStr);
    previewBytesSpan.textContent = `Bytes: ${bytes.length} (Expected: ${expectedBytes})`;
    if (bytes.length !== expectedBytes) { 
        previewErrorP.textContent = `Byte count mismatch: Found ${bytes.length}, expected ${expectedBytes}.`;
        previewErrorP.classList.remove('hidden');
        commitImportBtn.disabled = true;
        commitImportBtn.classList.add('opacity-50', 'cursor-not-allowed');
        parsedGrid = null;
        return;
    }
    parsedGrid = parseCArray(bytes, w, h);
    if (parsedGrid) {
        drawPreviewGrid(parsedGrid, w, h);
        previewErrorP.classList.add('hidden');
        commitImportBtn.disabled = false;
        commitImportBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else { 
        previewErrorP.textContent = 'Failed to generate grid.';
        previewErrorP.classList.remove('hidden');
    }
}
function drawPreviewGrid(grid, w, h) {
    const canvasW = previewCanvas.width, canvasH = previewCanvas.height;
    const size = Math.min(canvasW / w, canvasH / h);
    previewCtx.clearRect(0, 0, canvasW, canvasH);
    previewCtx.fillStyle = '#000000'; 
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (grid[y][x]) previewCtx.fillRect(x * size, y * size, size, size);
        }
    }
}
function handleImport() {
    if (parsedGrid && frames.length > 0) {
        getActiveLayers()[activeLayerIndex].data = parsedGrid;
        updateUI();
        hideImportModal();
    }
}

// --- Animation Logic ---
function animate(timestamp) {
    if (!isPlaying) return;
    if (!lastTimestamp) lastTimestamp = timestamp;
    const elapsed = timestamp - lastTimestamp;
    if (elapsed > animationSpeed) {
        animationFrame = (animationFrame + 1) % frames.length;
        lastTimestamp = timestamp;
        currentAnimationFrame = frames[animationFrame];
        playerCurrentFrameSpan.textContent = animationFrame + 1;
        drawScene(playerCtx, playerCanvas, pixelSize, currentAnimationFrame.layers);
    }
    animationFrameId = requestAnimationFrame(animate);
}
function playAnimation() {
    if (frames.length < 2) { drawScene(playerCtx, playerCanvas, pixelSize, getActiveLayers()); return; }
    if (isPlaying) return;
    isPlaying = true;
    playStopBtn.innerHTML = '❚❚'; 
    playStopBtn.classList.replace('bg-red-600', 'bg-amber-600');
    lastTimestamp = 0;
    animationFrame = currentFrameIndex;
    animationSpeed = parseInt(speedInput.value, 10) || 250;
    currentAnimationFrame = frames[animationFrame];
    animationFrameId = requestAnimationFrame(animate);
}
function stopAnimation() {
    if (!isPlaying) return;
    isPlaying = false;
    playStopBtn.innerHTML = '▶'; 
    playStopBtn.classList.replace('bg-amber-600', 'bg-red-600');
    cancelAnimationFrame(animationFrameId);
    drawScene(playerCtx, playerCanvas, pixelSize, getActiveLayers());
    playerCurrentFrameSpan.textContent = currentFrameIndex + 1;
}
function navigateFrame(direction) {
    stopAnimation(); 
    currentFrameIndex = (currentFrameIndex + direction + frames.length) % frames.length;
    selectFrame(currentFrameIndex);
}

// --- Initialization ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-page').forEach(page => page.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active-tab'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active-tab');
    if (tabId === 'editor') updateUI();
    else if (tabId === 'player') { stopAnimation(); drawScene(playerCtx, playerCanvas, pixelSize, getActiveLayers()); }
}

function initTools() {
    toolPanelDiv.innerHTML = '';
    TOOLS.forEach(tool => {
        const btn = document.createElement('button');
        btn.id = `tool-${tool.id}`;
        btn.className = `tool-btn p-3 rounded-md transition duration-150 font-bold border border-stone-600 ${tool.id === currentTool ? 'active' : ''}`;
        btn.innerHTML = tool.icon;
        btn.title = tool.name;
        btn.addEventListener('click', () => {
            currentTool = tool.id;
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            canvas.style.cursor = tool.cursor;
        });
        toolPanelDiv.appendChild(btn);
    });
    canvas.style.cursor = TOOLS.find(t => t.id === currentTool).cursor;
}

function initEditor(width, height) {
    iconWidth = width;
    iconHeight = height;
    pixelSize = MAX_CANVAS_WIDTH / iconWidth; 
    canvas.width = MAX_CANVAS_WIDTH;
    canvas.height = MAX_CANVAS_WIDTH * (iconHeight / iconWidth); 
    playerCanvas.width = MAX_CANVAS_WIDTH;
    playerCanvas.height = MAX_CANVAS_WIDTH * (iconHeight / iconWidth); 

    if (frames.length === 0) {
        addFrame(false); 
    } else {
        frames.forEach(frame => {
            frame.layers.forEach(layer => {
                const oldData = layer.data;
                const newGrid = createBlankGrid(iconWidth, iconHeight);
                for(let y = 0; y < Math.min(iconHeight, oldData.length); y++) {
                    for(let x = 0; x < Math.min(iconWidth, oldData[0].length); x++) {
                        newGrid[y][x] = oldData[y][x];
                    }
                }
                layer.data = newGrid;
            });
        });
        selectFrame(currentFrameIndex); 
    }
    renderFrameList();
    renderLayerList();
    updateUI();
}

// Listeners
canvas.addEventListener('mousedown', handleStart);
canvas.addEventListener('mousemove', handleMove);
document.addEventListener('mouseup', handleEnd); 
canvas.addEventListener('touchstart', handleStart);
canvas.addEventListener('touchmove', handleMove);
document.addEventListener('touchend', handleEnd);

document.getElementById('clearBtn').addEventListener('click', () => { getActiveLayers()[activeLayerIndex].data = createBlankGrid(iconWidth, iconHeight); updateUI(); });
document.getElementById('applyResBtn').addEventListener('click', () => initEditor(parseInt(inputWidth.value, 10), parseInt(inputHeight.value, 10)));
document.getElementById('newLayerBtn').addEventListener('click', () => { if (frames.length > 0) createNewLayer(); });
moveFrameUpBtn.addEventListener('click', () => moveFrame(-1));
moveFrameDownBtn.addEventListener('click', () => moveFrame(1));
duplicateFrameBtn.addEventListener('click', () => addFrame(true));
blankFrameBtn.addEventListener('click', () => addFrame(false));
generateSingleFrameBtn.addEventListener('click', () => generateAndDisplayCode('single'));
generateAnimationBtn.addEventListener('click', () => generateAndDisplayCode('animation'));

copyOutputBtn.addEventListener('click', () => {
    const temp = document.createElement('textarea');
    temp.value = byteOutputDiv.textContent;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    copyOutputBtn.textContent = 'Copied!';
    setTimeout(() => copyOutputBtn.textContent = 'Copy to Clipboard', 2000);
});
exportCFileBtn.addEventListener('click', (e) => {
    if (e.target.dataset.code) downloadCFile(e.target.dataset.code, e.target.dataset.filename || 'export.c');
});

mainImportBtn.addEventListener('click', showImportModal);
cancelImportBtn.addEventListener('click', hideImportModal);
previewArrayBtn.addEventListener('click', handlePreview);
commitImportBtn.addEventListener('click', handleImport);

playStopBtn.addEventListener('click', () => isPlaying ? stopAnimation() : playAnimation());
nextFrameBtn.addEventListener('click', () => navigateFrame(1));
prevFrameBtn.addEventListener('click', () => navigateFrame(-1));
speedInput.addEventListener('input', (e) => {
    animationSpeed = parseInt(e.target.value, 10);
    if (isPlaying) { stopAnimation(); playAnimation(); }
});
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

function showImportModal() {
    if (frames.length === 0) addFrame(false);
    importModal.classList.remove('hidden');
    previewErrorP.classList.add('hidden');
    commitImportBtn.disabled = true;
    commitImportBtn.classList.add('opacity-50', 'cursor-not-allowed');
    previewDimsSpan.textContent = `W: ${iconWidth} H: ${iconHeight}`;
    previewBytesSpan.textContent = `Bytes: ${Math.ceil(iconWidth / 8) * iconHeight} (Expected)`;
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    arrayInput.focus();
}
function hideImportModal() {
    importModal.classList.add('hidden');
    arrayInput.value = '';
    parsedGrid = null;
}

window.onload = function() {
    initTools();
    initEditor(parseInt(inputWidth.value, 10), parseInt(inputHeight.value, 10)); 
    switchTab('editor'); 
};
