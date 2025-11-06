// -------------------------------------------------------------------
// 文件: 30ver.js (目标跟踪/平滑ROI，解决圆柱体和手抖动问题)
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

// 🎯 新增：平滑跟踪变量
let currentROI_X = 0; 
const ROI_SMOOTH_FACTOR = 0.1; // 平滑系数 (0.01-1.0，越小越平滑)
const INITIAL_ROI_W = 20;    // 调整 ROI 宽度，使其更窄，适应圆柱体顶部
const ROI_W = INITIAL_ROI_W; 


// --- 音乐常量 (15个指定音阶，最低音 C4 在顶部，最高音 B6 在底部) ---
const TARGET_NOTES = [
    { name: "C4", midi: 60 }, 
    { name: "D4", midi: 62 }, 
    { name: "E4", midi: 64 }, 
    { name: "F4", midi: 65 }, 
    { name: "G4", midi: 67 }, 
    { name: "A4", midi: 69 }, 
    { name: "B4", midi: 71 }, 
    { name: "C5", midi: 72 }, 
    { name: "D5", midi: 74 }, 
    { name: "E5", midi: 76 }, 
    { name: "F5", midi: 77 }, 
    { name: "G5", midi: 79 }, 
    { name: "A5", midi: 81 }, 
    { name: "C6", midi: 84 },
    { name: "B6", midi: 95 }  
];
const NUM_STEPS = TARGET_NOTES.length; 

let PITCH_MAP = {};     
let GRID_LINES = {};    


// --- (辅助函数和 AudioContext 逻辑保持不变) ---

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
                
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                createGridMap(canvas.height); 
                
                cap = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
                src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC1);
                
                // 🎯 初始化 ROI 跟踪位置为屏幕中心
                currentROI_X = canvas.width / 2 - ROI_W / 2;
                
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


// --- 实时图像处理循环 (实现平滑跟踪) ---

function processVideo() {
    if (!isProcessing) return;

    // 1. 视频帧采集和预处理
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cap.data.set(imageData.data); 
    
    cv.cvtColor(cap, src, cv.COLOR_RGBA2GRAY, 0); 
    cv.threshold(src, src, 120, 255, cv.THRESH_BINARY_INV); 
    
    let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
    cv.erode(src, src, kernel); 
    kernel.delete();


    // 4. 查找轮廓 (在 ROI 绘制之前先找到轮廓，以便计算新的 ROI 位置)
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE); 
    
    let currentPitches = []; 
    let currentNoteNames = [];
    let detectedCenterXs = []; // 🎯 用于计算平均中心位置

    
    // 5. 遍历轮廓并进行严格筛选 (先进行形状过滤，找到所有可能的有效圆点)
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        // 1. 面积过滤
        if (area < 100 || area > 4000) { 
            continue;
        }

        let rect = cv.boundingRect(contour);
        
        // 2. 形状过滤 (长宽比和圆度)
        const aspectRatio = rect.width / rect.height;
        if (aspectRatio < 0.5 || aspectRatio > 2.0) {
            continue;
        }
        
        let hull = new cv.Mat();
        cv.convexHull(contour, hull);
        const hullArea = cv.contourArea(hull);
        hull.delete(); 
        if (hullArea === 0) {
            continue;
        }
        
        const solidity = area / hullArea;
        if (solidity < 0.8) { 
            continue;
        }
        
        // 🎯 形状和面积都合格，记录其中心点X坐标
        let center_x = rect.x + rect.width / 2;
        detectedCenterXs.push(center_x); 
    }
    
    // 6. 🎯 目标跟踪：计算和更新 ROI 位置
    
    let newCenter_X;
    if (detectedCenterXs.length > 0) {
        // 计算所有检测到的有效圆点的平均 X 坐标
        const sumX = detectedCenterXs.reduce((a, b) => a + b, 0);
        const averageX = sumX / detectedCenterXs.length;
        
        // 计算新的 ROI 左侧 X 坐标 (保持 ROI 宽度不变)
        newCenter_X = averageX - ROI_W / 2;
        
        // 使用平滑因子更新 ROI_X
        currentROI_X = (ROI_SMOOTH_FACTOR * newCenter_X) + ((1 - ROI_SMOOTH_FACTOR) * currentROI_X);
        
        // 确保 ROI_X 不超出 Canvas 边界
        if (currentROI_X < 0) currentROI_X = 0;
        if (currentROI_X + ROI_W > canvas.width) currentROI_X = canvas.width - ROI_W;

    } else if (lastDetectedPitches.length === 0) {
        // 如果没有检测到音符且上次也没有，让 ROI 慢慢回到中心
        const targetCenter = canvas.width / 2 - ROI_W / 2;
        currentROI_X = (0.005 * targetCenter) + (0.995 * currentROI_X);
    }
    
    // 7. 绘制动态 ROI 和中线
    
    // 绘制动态 ROI 框 (绿色)
    cv.rectangle(cap, new cv.Point(currentROI_X, 0), new cv.Point(currentROI_X + ROI_W, canvas.height), [0, 255, 0, 255], 2);
    
    // 只绘制中线（大红色）和音符名称 (与之前版本相同)
    const keys = Object.keys(PITCH_MAP).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < NUM_STEPS; i++) {
        const center_y = keys[i]; 
        const pitchInfo = PITCH_MAP[center_y];

        if (pitchInfo) {
            // 绘制中线
            cv.line(cap, 
                new cv.Point(0, pitchInfo.midY), 
                new cv.Point(canvas.width, pitchInfo.midY), 
                [0, 0, 255, 255], // 纯红色
                1
            );
            // 绘制音符名称
            cv.putText(cap, pitchInfo.name, new cv.Point(5, pitchInfo.minY + 10), cv.FONT_HERSHEY_SIMPLEX, 0.3, [255, 0, 0, 255], 1);
        }
    }

    // 8. 第二次遍历轮廓：根据新的 ROI 位置进行音高识别和发声
    
    // ⚠️ 重新查找轮廓以避免内存泄漏 (或者在第一次遍历时保留轮廓，这里为了简化代码重新查找)
    contours.delete();
    hierarchy.delete();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE); 
    
    currentPitches = []; 
    currentNoteNames = [];
    
    // 遍历轮廓并使用动态 ROI 进行识别
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        // 沿用之前的严格过滤条件 (面积和形状)
        let rect = cv.boundingRect(contour);
        const aspectRatio = rect.width / rect.height;
        if (area < 100 || area > 4000 || aspectRatio < 0.5 || aspectRatio > 2.0) {
            // 忽略不合格的轮廓
            continue;
        }

        let center_x = rect.x + rect.width / 2;
        let center_y = rect.y + rect.height / 2;

        // 🎯 使用动态 currentROI_X 进行 ROI 检查
        if (center_x >= currentROI_X && center_x <= currentROI_X + ROI_W) {
            cv.circle(cap, new cv.Point(center_x, center_y), 5, [255, 0, 0, 255], -1); // 识别成功的圆点显示为蓝色

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
    
    // 9. 发声逻辑 (保持不变)
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


    // 10. 输出图像和清理 
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
