// -------------------------------------------------------------------
// 文件: 30ver.js (适配手机尺寸，移除视频显示水平翻转，强化 AudioContext 恢复逻辑)
// -------------------------------------------------------------------

// --- 全局变量 ---
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const statusElement = document.getElementById('status');

let cap = null;     
let src = null;     
let audioCtx = null;
let isProcessing = false;
let lastDetectedPitches = []; 
let videoStream = null; 

// --- 音乐常量 (15个指定音阶，从最高音 B6 到最低音 C4 反序排列) ---
const TARGET_NOTES = [
    { name: "B6", midi: 95 }, 
    { name: "C6", midi: 84 }, 
    { name: "A5", midi: 81 }, 
    { name: "G5", midi: 79 }, 
    { name: "F5", midi: 77 }, 
    { name: "E5", midi: 76 }, 
    { name: "D5", midi: 74 }, 
    { name: "C5", midi: 72 }, 
    { name: "B4", midi: 71 }, 
    { name: "A4", midi: 69 }, 
    { name: "G4", midi: 67 }, 
    { name: "F4", midi: 65 }, 
    { name: "E4", midi: 64 }, 
    { name: "D4", midi: 62 }, 
    { name: "C4", midi: 60 } 
];
const NUM_STEPS = TARGET_NOTES.length; 

let PITCH_MAP = {};     
let GRID_LINES = {};    


// --- 辅助函数 (保持不变) ---
function getFreqFromMidi(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort((x, y) => x - y);
    const sortedB = [...b].sort((x, y) => x - y);
    for (let i = 0; i < a.length; i++) {
        if (sortedA[i] !== sortedB[i]) return false;
    }
    return true;
}

function createGridMap(canvasHeight) {
    const margin = 10; 
    const usableHeight = canvasHeight - 2 * margin;
    const stepHeight = usableHeight / NUM_STEPS;
    
    const pitchMap = {};
    const gridLines = [];
    
    for (let i = 0; i < NUM_STEPS; i++) {
        const note = TARGET_NOTES[i];
        const center_y = margin + (i * stepHeight) + (stepHeight / 2);
        const line_y = margin + (i * stepHeight);
        
        gridLines.push({y: line_y, type: 'edge'}); 

        const frequency = getFreqFromMidi(note.midi);

        pitchMap[Math.round(center_y)] = {
            freq: frequency,
            name: note.name,
            minY: line_y,
            maxY: line_y + stepHeight,
            midY: center_y 
        };
    }
    gridLines.push({y: margin + NUM_STEPS * stepHeight, type: 'edge'}); 
    
    PITCH_MAP = pitchMap;
    GRID_LINES = gridLines;
    statusElement.innerHTML += ` 已生成 ${NUM_STEPS} 阶精确音高映射。`;
}


// --- 初始化、控制和发声 ---

function onOpenCvLoaded() {
    statusElement.innerHTML = 'OpenCV 加载完毕，请点击开始按钮。';
    
    if (startButton && stopButton) {
        startButton.disabled = false;
        stopButton.disabled = true; 
        startButton.addEventListener('click', initCameraAndAudio);
        stopButton.addEventListener('click', stopProcessing);
    } else {
        statusElement.innerHTML = '错误: 缺少开始/停止按钮元素。';
        console.error("无法找到开始或停止按钮。请检查 HTML ID.");
    }
}

function initCameraAndAudio() {
    if (isProcessing) return;
    
    startButton.disabled = true;
    stopButton.disabled = true; 
    statusElement.innerHTML = '请求摄像头权限...';

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.error("AudioContext resume failed on click:", e));
    }


    navigator.mediaDevices.getUserMedia({ 
        video: { 
            facingMode: { exact: "environment" } 
        }, 
        audio: false 
    })
        .then(function(stream) {
            videoStream = stream; 
            video.srcObject = stream;
            video.onloadedmetadata = function() {
                video.play();
                
                // 关键修改：确保 Canvas 尺寸与视频流原始尺寸匹配
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                createGridMap(canvas.height); 
                
                cap = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
                src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC1);
                
                statusElement.innerHTML = '摄像头就绪，开始识别...';
                isProcessing = true;
                
                startButton.disabled = true;
                stopButton.disabled = false; 
                
                requestAnimationFrame(processVideo);
            };
        })
        .catch(function(err) {
            statusElement.innerHTML = '无法获取摄像头: ' + err;
            startButton.disabled = false;
            stopButton.disabled = true;
        });
}

function stopProcessing() {
    if (!isProcessing) return;

    isProcessing = false;
    statusElement.innerHTML = '扫描已停止。';
    
    startButton.disabled = false;
    stopButton.disabled = true;
    lastDetectedPitches = []; 
    
    if (videoStream) {
        const tracks = videoStream.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
        videoStream = null;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (cap) { cap.delete(); cap = null; }
    if (src) { src.delete(); src = null; }

    if (audioCtx) {
        audioCtx.close().then(() => {
            audioCtx = null;
        }).catch(e => console.error("AudioContext close failed:", e));
    }
}

function _triggerPlay(frequencies) {
     frequencies.forEach(frequency => {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime); 
        
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.005); 
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1); 

        oscillator.connect(gainNode).connect(audioCtx.destination);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15); 
    });
}

function playNotes(frequencies) {
    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
             _triggerPlay(frequencies);
        }).catch(e => {
            console.error("AudioContext resume failed in playNotes:", e);
            _triggerPlay(frequencies);
        });
    } else {
        _triggerPlay(frequencies);
    }
}


// --- 实时图像处理循环 (移除视频翻转) ---

function processVideo() {
    if (!isProcessing) return;

    // 1. 视频帧采集、翻转和预处理
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cap.data.set(imageData.data); 

    // 🌟 关键修改：移除 cv.flip(cap, cap, 1); 
    // 现在视频会以原始（非镜像）方式显示。
    
    cv.cvtColor(cap, src, cv.COLOR_RGBA2GRAY, 0); 
    cv.threshold(src, src, 120, 255, cv.THRESH_BINARY_INV); 
    
    let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
    cv.erode(src, src, kernel); 
    kernel.delete();


    // 3. 定义 ROI 和绘制格子 (保持不变)
    const ROI_X = canvas.width / 2 - 20;
    const ROI_W = 40; 
    
    cv.rectangle(cap, new cv.Point(ROI_X, 0), new cv.Point(ROI_X + ROI_W, canvas.height), [0, 255, 0, 255], 2);
    
    
    for (let i = 0; i < GRID_LINES.length; i++) {
        const line = GRID_LINES[i];
        cv.line(cap, new cv.Point(0, line.y), new cv.Point(canvas.width, line.y), [150, 150, 150, 255], 1);
    }
    
    const keys = Object.keys(PITCH_MAP).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < NUM_STEPS; i++) {
        const center_y = keys[i]; 
        const pitchInfo = PITCH_MAP[center_y];

        if (pitchInfo) {
            cv.line(cap, 
                new cv.Point(0, pitchInfo.midY), 
                new cv.Point(canvas.width, pitchInfo.midY), 
                [0, 0, 255, 255], // 纯红色
                1
            );
            cv.putText(cap, pitchInfo.name, new cv.Point(5, pitchInfo.minY + 10), cv.FONT_HERSHEY_SIMPLEX, 0.3, [255, 0, 0, 255], 1);
        }
    }


    // 4. 查找轮廓 (保持不变)
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE); 
    
    let currentPitches = []; 
    let currentNoteNames = [];
    
    // 5. 遍历轮廓并检测是否在 ROI 内 (保持不变)
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        if (area > 100 && area < 4000) { 
            let rect = cv.boundingRect(contour);
            let center_x = rect.x + rect.width / 2;
            let center_y = rect.y + rect.height / 2;
            
            if (center_x >= ROI_X && center_x <= ROI_X + ROI_W) {
                cv.circle(cap, new cv.Point(center_x, center_y), 5, [0, 0, 255, 255], -1); 

                for (const key in PITCH_MAP) {
                    const pitchInfo = PITCH_MAP[key];
                    if (center_y >= pitchInfo.minY && center_y < pitchInfo.maxY) {
                        currentPitches.push(pitchInfo.freq);
                        currentNoteNames.push(pitchInfo.name);
                        break; 
                    }
                }
            }
        }
    }
    
    // 7. 发声逻辑 (保持不变)
    const uniquePitches = Array.from(new Set(currentPitches)); 
    const uniqueNames = Array.from(new Set(currentNoteNames));
    
    if (uniquePitches.length > 0 && !arraysEqual(uniquePitches, lastDetectedPitches)) {
        playNotes(uniquePitches);
        lastDetectedPitches = uniquePitches;
        
        let namesDisplay = uniqueNames.join(' + ');
        statusElement.innerHTML = `正在演奏和弦: ${namesDisplay}`;
    } else if (uniquePitches.length === 0 && lastDetectedPitches.length > 0) {
        lastDetectedPitches = [];
        statusElement.innerHTML = '等待音符...';
    } else if (uniquePitches.length > 0) {
        let namesDisplay = uniqueNames.join(' + ');
        statusElement.innerHTML = `保持和弦: ${namesDisplay}`;
    }


    // 8. 输出图像和清理 (保持不变)
    cv.imshow('canvasOutput', cap);

    contours.delete();
    hierarchy.delete();
    
    requestAnimationFrame(processVideo);
}

// 释放 OpenCV 内存
window.onunload = () => {
    if (cap) cap.delete();
    if (src) src.delete();
};
