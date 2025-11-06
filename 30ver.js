// -------------------------------------------------------------------
// 文件: 30ver.js (最小化UI，仅保留中央ROI和上下基准点进行动态Y轴校正)
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

// 🎯 固定 ROI 变量 (保持不变)
const ROI_W = 20;    
let fixedROI_X = 0; 

// 🎯 Y 轴基准点和音阶定义 (保持不变)
const ANCHOR_TOP_NAME = "ANCHOR_TOP";
const ANCHOR_BOTTOM_NAME = "ANCHOR_BOTTOM";
// 音乐常量：只有音符需要发声，基准点不再显示名称
const TARGET_NOTES_ONLY = [
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
const NUM_MUSICAL_NOTES = TARGET_NOTES_ONLY.length; 
// 实际总区域数 = 音符数 + 2个基准点
const NUM_TOTAL_REGIONS = NUM_MUSICAL_NOTES + 2;

// 动态生成的音高映射表，现在包含基准点信息
let PITCH_MAP = {}; 
// 缓存上一次的基准点Y坐标，用于丢失基准点时保持稳定
let lastTopY = null;
let lastBottomY = null;

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

// 🎯 动态网格映射函数 (现在只关注生成正确的音高区域，不绘制)
function createDynamicGridMap(topY, bottomY, canvasHeight) {
    
    const fixedTopY = topY !== null ? topY : (lastTopY !== null ? lastTopY : 10);
    const fixedBottomY = bottomY !== null ? bottomY : (lastBottomY !== null ? lastBottomY : canvasHeight - 10);
    
    if (topY !== null && bottomY !== null) { // 成功检测到基准点时才更新缓存
        lastTopY = fixedTopY;
        lastBottomY = fixedBottomY;
    }
    
    if (fixedBottomY <= fixedTopY + 5) { // 避免高度过小导致错误
        return;
    }
    
    const actualHeight = fixedBottomY - fixedTopY;
    // 实际每个区域的高度 (总区域数包括基准点)
    const actualStepHeight = actualHeight / (NUM_TOTAL_REGIONS - 1); 
    
    const pitchMap = {};
    
    // 首先添加顶部基准点
    pitchMap[Math.round(fixedTopY)] = {
        freq: 0, // 不发声
        name: ANCHOR_TOP_NAME,
        minY: fixedTopY,
        maxY: fixedTopY + actualStepHeight,
        midY: fixedTopY + actualStepHeight / 2
    };

    // 接着添加音乐音符
    for (let i = 0; i < NUM_MUSICAL_NOTES; i++) {
        const note = TARGET_NOTES_ONLY[i];
        
        // 音符的 Y 轴位置从顶部基准点下方开始
        const line_y = fixedTopY + ((i + 1) * actualStepHeight);
        const center_y = line_y + (actualStepHeight / 2);
        
        const frequency = getFreqFromMidi(note.midi);

        pitchMap[Math.round(center_y)] = {
            freq: frequency,
            name: note.name,
            minY: line_y,
            maxY: line_y + actualStepHeight,
            midY: center_y 
        };
    }

    // 最后添加底部基准点
    const bottomAnchorLineY = fixedTopY + ((NUM_TOTAL_REGIONS - 1) * actualStepHeight);
    pitchMap[Math.round(bottomAnchorLineY)] = {
        freq: 0, // 不发声
        name: ANCHOR_BOTTOM_NAME,
        minY: bottomAnchorLineY,
        maxY: bottomAnchorLineY + actualStepHeight, // 实际上是到图像底部，但保持步长一致性
        midY: bottomAnchorLineY + actualStepHeight / 2
    };
    
    PITCH_MAP = pitchMap;
}


// --- 初始化、控制和发声 (修改 ROI 初始化) ---

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
                
                fixedROI_X = canvas.width / 2 - ROI_W / 2;
                
                // 初始网格映射：使用默认值 (10 和 height-10)
                createDynamicGridMap(null, null, canvas.height); 
                
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


// --- 实时图像处理循环 (最小化UI，仅保留中央ROI和Y轴校正) ---

function processVideo() {
    if (!isProcessing) return;

    // 1. 视频帧采集和预处理
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cap.data.set(imageData.data); 
    
    cv.cvtColor(cap, src, cv.COLOR_RGBA2GRAY, 0); 
    cv.threshold(src, src, 120, 255, cv.THRESH_BINARY_INV); 
    
    let kernel = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
    cv.erode(src, src, kernel); 
    kernel.delete();


    // 2. 查找轮廓
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE); 
    
    let topAnchorYs = [];       
    let bottomAnchorYs = [];    
    let currentPitches = []; 
    let currentNoteNames = [];
    
    // 3. 遍历轮廓并进行所有识别和收集
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        // 面积过滤
        if (area < 100 || area > 4000) { 
            continue;
        }

        let rect = cv.boundingRect(contour);
        
        // 形状过滤 (长宽比)
        const aspectRatio = rect.width / rect.height;
        if (aspectRatio < 0.5 || aspectRatio > 2.0) {
            continue;
        }
        
        // 形状过滤 (圆度)
        let hull = new cv.Mat();
        cv.convexHull(contour, hull);
        const hullArea = cv.contourArea(hull);
        hull.delete(); 
        if (hullArea === 0 || area / hullArea < 0.8) {
            continue;
        }
        
        let center_x = rect.x + rect.width / 2;
        let center_y = rect.y + rect.height / 2;
        
        // 🎯 仅检查是否在固定的中央 ROI 内
        if (center_x >= fixedROI_X && center_x <= fixedROI_X + ROI_W) {
            
            // 识别成功的圆点显示为蓝色
            cv.circle(cap, new cv.Point(center_x, center_y), 5, [255, 0, 0, 255], -1); 
            
            // 识别音高和基准点
            // 注意：这里需要遍历 PITCH_MAP 的键，但要确保 PITCH_MAP 已经更新
            // 在这一帧中，PITCH_MAP 还是上一帧计算的，但这不是问题
            // 因为我们只收集 Y 轴基准点，真正的音高判断在 PITCH_MAP 更新后
            for (const key in PITCH_MAP) {
                const pitchInfo = PITCH_MAP[key];
                
                if (center_y >= pitchInfo.minY && center_y < pitchInfo.maxY) {
                    if (pitchInfo.name === ANCHOR_TOP_NAME) {
                        topAnchorYs.push(center_y);
                        break; 
                    } else if (pitchInfo.name === ANCHOR_BOTTOM_NAME) {
                        bottomAnchorYs.push(center_y);
                        break; 
                    } else {
                        // 识别音符
                        currentPitches.push(pitchInfo.freq);
                        currentNoteNames.push(pitchInfo.name);
                        break; 
                    }
                }
            }
        }
    }
    
    // 4. 🎯 Y 轴校正：计算新的网格映射 (基于这一帧收集到的基准点)
    let newTopY = null;
    let newBottomY = null;
    
    if (topAnchorYs.length > 0) {
        newTopY = topAnchorYs.reduce((a, b) => a + b, 0) / topAnchorYs.length;
    }
    if (bottomAnchorYs.length > 0) {
        newBottomY = bottomAnchorYs.reduce((a, b) => a + b, 0) / bottomAnchorYs.length;
    }
    
    createDynamicGridMap(newTopY, newBottomY, canvas.height); // 更新 PITCH_MAP
    
    
    // 5. (重新) 遍历轮廓以使用更新后的 PITCH_MAP 进行准确识别
    // 这一步是必要的，因为 PITCH_MAP 刚刚被 createDynamicGridMap 更新
    // 如果不重新遍历，音高判断会基于上一帧的 Y 轴校正
    currentPitches = []; 
    currentNoteNames = [];
    
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        let rect = cv.boundingRect(contour);
        const aspectRatio = rect.width / rect.height;
        if (area < 100 || area > 4000 || aspectRatio < 0.5 || aspectRatio > 2.0) {
            continue;
        }
        let hull = new cv.Mat();
        cv.convexHull(contour, hull);
        const hullArea = cv.contourArea(hull);
        hull.delete(); 
        if (hullArea === 0 || area / hullArea < 0.8) {
             continue;
        }
        
        let center_x = rect.x + rect.width / 2;
        let center_y = rect.y + rect.height / 2;

        if (center_x >= fixedROI_X && center_x <= fixedROI_X + ROI_W) {
            for (const key in PITCH_MAP) {
                const pitchInfo = PITCH_MAP[key];
                
                if (pitchInfo.midi === 0) continue; // 忽略基准点
                
                if (center_y >= pitchInfo.minY && center_y < pitchInfo.maxY) {
                    currentPitches.push(pitchInfo.freq);
                    currentNoteNames.push(pitchInfo.name);
                    break; 
                }
            }
        }
    }


    // 6. 绘制固定的 ROI
    cv.rectangle(cap, new cv.Point(fixedROI_X, 0), new cv.Point(fixedROI_X + ROI_W, canvas.height), [0, 255, 0, 255], 2);
    
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


    // 8. 输出图像和清理 
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
