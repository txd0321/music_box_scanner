// -------------------------------------------------------------------
// 文件: 30ver.js (新增顶部和底部基准点，实现动态Y轴透视校正)
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

// 🎯 平滑跟踪变量 (保持不变)
let currentROI_X = 0; 
const ROI_SMOOTH_FACTOR = 0.1; 
const ROI_W = 20; 

// 🎯 基准点和音阶定义 (新增两个基准点)
const ANCHOR_TOP_NAME = "ANCHOR_TOP";
const ANCHOR_BOTTOM_NAME = "ANCHOR_BOTTOM";
// 音乐常量：新增两个基准点，它们只用于跟踪，不发声 (midi: 0)
const TARGET_NOTES_WITH_ANCHORS = [
    { name: ANCHOR_TOP_NAME, midi: 0 },   // 顶部基准点
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
    { name: "B6", midi: 95 },
    { name: ANCHOR_BOTTOM_NAME, midi: 0 } // 底部基准点
];
const NUM_REGIONS = TARGET_NOTES_WITH_ANCHORS.length; // 总共 17 个区域

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

// 🎯 动态网格映射函数 (基于实际检测到的 Y 坐标)
function createDynamicGridMap(topY, bottomY, canvasHeight) {
    
    // 如果没有检测到基准点，使用上次的或默认值
    const fixedTopY = topY !== null ? topY : 10;
    const fixedBottomY = bottomY !== null ? bottomY : canvasHeight - 10;
    
    // 实际音阶区域总高度
    const actualHeight = fixedBottomY - fixedTopY;
    
    // 实际每个区域的高度 (17 个区域)
    const actualStepHeight = actualHeight / (NUM_REGIONS - 1); // 区域之间有 NUM_REGIONS - 1 个间隔
    
    const pitchMap = {};
    
    for (let i = 0; i < NUM_REGIONS; i++) {
        const note = TARGET_NOTES_WITH_ANCHORS[i];
        
        // 计算当前区域的顶部、中部和底部 Y 坐标
        const line_y = fixedTopY + (i * actualStepHeight);
        const center_y = line_y + (actualStepHeight / 2);
        
        // 只有非基准点才需要发声信息
        const frequency = note.midi !== 0 ? getFreqFromMidi(note.midi) : 0;

        pitchMap[Math.round(center_y)] = {
            freq: frequency,
            name: note.name,
            minY: line_y,
            maxY: line_y + actualStepHeight,
            midY: center_y 
        };
    }
    
    PITCH_MAP = pitchMap;
    // 不再需要 GRID_LINES，因为网格是动态生成的
}


// --- 初始化、控制和发声 (保持不变) ---

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
                
                // 初始网格映射：使用默认值 (10 和 height-10)
                createDynamicGridMap(null, null, canvas.height); 
                
                cap = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
                src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC1);
                
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


// --- 实时图像处理循环 (实现动态 Y 轴校正) ---

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
    
    let detectedCenterXs = []; // 🎯 用于 X 轴跟踪
    let topAnchorYs = [];       // 🎯 用于 Y 轴校正
    let bottomAnchorYs = [];    // 🎯 用于 Y 轴校正
    
    // 3. 遍历轮廓并进行严格筛选，同时收集 X/Y 轴跟踪数据
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        // 面积过滤
        if (area < 100 || area > 4000) { 
            continue;
        }

        let rect = cv.boundingRect(contour);
        
        // 形状过滤 (长宽比和圆度)
        const aspectRatio = rect.width / rect.height;
        if (aspectRatio < 0.5 || aspectRatio > 2.0) {
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
        
        // 🎯 收集 X 轴跟踪数据 (所有合格圆点)
        detectedCenterXs.push(center_x); 

        // 🎯 收集 Y 轴基准点数据
        for (const key in PITCH_MAP) {
            const pitchInfo = PITCH_MAP[key];
            if (center_y >= pitchInfo.minY && center_y < pitchInfo.maxY) {
                if (pitchInfo.name === ANCHOR_TOP_NAME) {
                    topAnchorYs.push(center_y);
                    break;
                } else if (pitchInfo.name === ANCHOR_BOTTOM_NAME) {
                    bottomAnchorYs.push(center_y);
                    break;
                }
            }
        }
    }
    
    // 4. 🎯 Y 轴校正：计算新的网格映射
    let newTopY = null;
    let newBottomY = null;
    
    // 平滑 Y 轴基准点
    if (topAnchorYs.length > 0) {
        const avgTopY = topAnchorYs.reduce((a, b) => a + b, 0) / topAnchorYs.length;
        // 使用一个简单的平滑逻辑，确保平滑地跟随 Y 轴变化
        newTopY = avgTopY; 
    }
    if (bottomAnchorYs.length > 0) {
        const avgBottomY = bottomAnchorYs.reduce((a, b) => a + b, 0) / bottomAnchorYs.length;
        newBottomY = avgBottomY;
    }
    
    // 如果成功检测到两个基准点，则使用动态校正
    if (newTopY !== null && newBottomY !== null && newBottomY > newTopY) {
        createDynamicGridMap(newTopY, newBottomY, canvas.height);
    } 
    // 否则，保持上一次的映射 (PITCH_MAP 不变)


    // 5. 🎯 X 轴跟踪：计算和更新 ROI 位置 (与上个版本相同)
    
    if (detectedCenterXs.length > 0) {
        const sumX = detectedCenterXs.reduce((a, b) => a + b, 0);
        const averageX = sumX / detectedCenterXs.length;
        
        const newROI_X = averageX - ROI_W / 2;
        
        currentROI_X = (ROI_SMOOTH_FACTOR * newROI_X) + ((1 - ROI_SMOOTH_FACTOR) * currentROI_X);
        
        if (currentROI_X < 0) currentROI_X = 0;
        if (currentROI_X + ROI_W > canvas.width) currentROI_X = canvas.width - ROI_W;

    } else if (lastDetectedPitches.length === 0) {
        const targetCenter = canvas.width / 2 - ROI_W / 2;
        currentROI_X = (0.005 * targetCenter) + (0.995 * currentROI_X);
    }
    
    
    // 6. 绘制动态 ROI 和中线
    
    // 绘制动态 ROI 框 (绿色)
    cv.rectangle(cap, new cv.Point(currentROI_X, 0), new cv.Point(currentROI_X + ROI_W, canvas.height), [0, 255, 0, 255], 2);
    
    let keys = Object.keys(PITCH_MAP).map(Number).sort((a, b) => a - b);
    let currentNoteNames = [];
    let currentPitches = []; 

    // 绘制中线和音符名称 (使用动态 PITCH_MAP)
    for (let i = 0; i < NUM_REGIONS; i++) {
        const pitchInfo = PITCH_MAP[keys[i]];

        if (pitchInfo) {
            // 绘制中线 (基准点线用淡蓝色)
            let lineColor = (pitchInfo.name === ANCHOR_TOP_NAME || pitchInfo.name === ANCHOR_BOTTOM_NAME) 
                            ? [255, 100, 0, 255] // 橙色/蓝色用于基准点
                            : [0, 0, 255, 255];  // 红色用于音符线
            
            cv.line(cap, 
                new cv.Point(0, pitchInfo.midY), 
                new cv.Point(canvas.width, pitchInfo.midY), 
                lineColor, 
                1
            );
            
            // 绘制音符名称 (基准点名称用灰色)
            let nameColor = (pitchInfo.name === ANCHOR_TOP_NAME || pitchInfo.name === ANCHOR_BOTTOM_NAME)
                            ? [150, 150, 150, 255]
                            : [255, 0, 0, 255];
                            
            cv.putText(cap, pitchInfo.name, new cv.Point(5, pitchInfo.minY + 10), cv.FONT_HERSHEY_SIMPLEX, 0.3, nameColor, 1);
        }
    }

    // 7. 第三次遍历轮廓：根据新的 ROI 和动态 Y 轴识别音高
    
    // ⚠️ 重新查找轮廓以确保所有点的内存都已释放
    contours.delete();
    hierarchy.delete();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE); 
    
    
    // 遍历轮廓并使用动态 ROI 和动态 Y 轴区域进行识别
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        // 沿用之前的严格过滤条件
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

        // 🎯 使用动态 currentROI_X 进行 ROI 检查
        if (center_x >= currentROI_X && center_x <= currentROI_X + ROI_W) {
            
            // 识别成功的圆点显示为蓝色
            cv.circle(cap, new cv.Point(center_x, center_y), 5, [255, 0, 0, 255], -1); 

            // 🎯 使用动态 PITCH_MAP 进行音高识别
            for (const key in PITCH_MAP) {
                const pitchInfo = PITCH_MAP[key];
                
                // 忽略基准点，只识别音符
                if (pitchInfo.midi === 0) continue; 
                
                if (center_y >= pitchInfo.minY && center_y < pitchInfo.maxY) {
                    currentPitches.push(pitchInfo.freq);
                    currentNoteNames.push(pitchInfo.name);
                    break; 
                }
            }
        }
    }
    
    // 8. 发声逻辑 (保持不变)
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


    // 9. 输出图像和清理 
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
