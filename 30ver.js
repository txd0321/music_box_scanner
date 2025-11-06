// -------------------------------------------------------------------
// 文件: 30ver.js (完整代码)
// -------------------------------------------------------------------

// --- 全局变量 ---
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton'); // 停止按钮引用
const statusElement = document.getElementById('status');

let cap = null;     
let src = null;     
let audioCtx = null;
let isProcessing = false;
let lastDetectedPitches = []; // 存储上一次检测到的音高数组（用于和弦去重）
let videoStream = null; // 用于存储媒体流，以便停止

// --- 音乐常量 ---
// 30个音阶，从 E6 (最高音) 到 C3 (最低音) 反序排列，确保 C3 在 Canvas 底部
const TARGET_NOTES = [
    // 高音: E6, D6, C6 (3个音阶) - 在 Canvas 顶部
    { name: "E6", midi: 88 }, 
    { name: "D6", midi: 86 }, 
    { name: "C6", midi: 84 }, 

    // 中高音: B5 到 C5 (12个音阶)
    { name: "B5", midi: 83 }, { name: "A#5", midi: 82 }, { name: "A5", midi: 81 }, 
    { name: "G#5", midi: 80 }, { name: "G5", midi: 79 }, { name: "F#5", midi: 78 }, 
    { name: "F5", midi: 77 }, { name: "E5", midi: 76 }, { name: "D#5", midi: 75 }, 
    { name: "D5", midi: 74 }, { name: "C#5", midi: 73 }, { name: "C5", midi: 72 }, 
    
    // 中低音: B4 到 C4 (10个音阶，移除了 C#4, D#4)
    { name: "B4", midi: 71 }, { name: "A#4", midi: 70 }, { name: "A4", midi: 69 }, 
    { name: "G#4", midi: 68 }, { name: "G4", midi: 67 }, { name: "F#4", midi: 66 }, 
    { name: "F4", midi: 65 }, { name: "E4", midi: 64 }, 
    { name: "D4", midi: 62 }, 
    { name: "C4", midi: 60 }, 

    // 低音: B3, A3, G3, D3, C3 (5个音阶) - 在 Canvas 底部
    { name: "B3", midi: 59 }, 
    { name: "A3", midi: 57 }, 
    { name: "G3", midi: 55 }, 
    { name: "D3", midi: 50 }, 
    { name: "C3", midi: 48 } 
];
const NUM_STEPS = TARGET_NOTES.length; // 30

let PITCH_MAP = {};     
let GRID_LINES = {};    


// --- 辅助函数 ---

function getFreqFromMidi(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
}

// 重新引入精确的数组比较函数，用于判断和弦是否发生变化
function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    // 必须排序后比较，因为检测顺序可能不同
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
    
    // 遍历 TARGET_NOTES，按顺序从上到下生成格子
    for (let i = 0; i < NUM_STEPS; i++) {
        const note = TARGET_NOTES[i];
        const center_y = margin + (i * stepHeight) + (stepHeight / 2);
        const line_y = margin + (i * stepHeight);
        gridLines.push({y: line_y});
        
        const frequency = getFreqFromMidi(note.midi);

        pitchMap[Math.round(center_y)] = {
            freq: frequency,
            name: note.name,
            minY: line_y,
            maxY: line_y + stepHeight
        };
    }
    gridLines.push({y: margin + NUM_STEPS * stepHeight}); 
    
    PITCH_MAP = pitchMap;
    GRID_LINES = gridLines;
    statusElement.innerHTML += ` 已生成 ${NUM_STEPS} 阶精确音高映射。`;
}


// --- 初始化、控制和发声 ---

function onOpenCvLoaded() {
    statusElement.innerHTML = 'OpenCV 加载完毕，请点击开始按钮。';
    
    // 初始化按钮状态并添加监听器
    if (startButton && stopButton) {
        startButton.disabled = false;
        stopButton.disabled = true; // 初始禁用停止按钮
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

    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(function(stream) {
            videoStream = stream; // 存储媒体流
            video.srcObject = stream;
            video.onloadedmetadata = function() {
                video.play();
                
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                createGridMap(canvas.height); 
                
                cap = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
                src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC1);
                
                statusElement.innerHTML = '摄像头就绪，开始识别...';
                isProcessing = true;
                
                // 成功后启用停止按钮
                startButton.disabled = true;
                stopButton.disabled = false; 
                
                requestAnimationFrame(processVideo);
            };
        })
        .catch(function(err) {
            statusElement.innerHTML = '无法获取摄像头: ' + err;
            // 失败后恢复开始按钮
            startButton.disabled = false;
            stopButton.disabled = true;
        });
}

function stopProcessing() {
    if (!isProcessing) return;

    isProcessing = false;
    statusElement.innerHTML = '扫描已停止。';
    
    // 状态转换：启用开始，禁用停止
    startButton.disabled = false;
    stopButton.disabled = true;
    lastDetectedPitches = []; 
    
    // 停止摄像头轨道
    if (videoStream) {
        const tracks = videoStream.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
        videoStream = null;
    }

    // 清空画布显示
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 清理 OpenCV 内存
    if (cap) { cap.delete(); cap = null; }
    if (src) { src.delete(); src = null; }

    // 关闭 AudioContext
    if (audioCtx) {
        audioCtx.close().then(() => {
            audioCtx = null;
        });
    }
}

function playNotes(frequencies) {
    if (!audioCtx) return;

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


// --- 实时图像处理循环 ---

function processVideo() {
    if (!isProcessing) return;

    // 1. 视频帧采集、翻转和预处理
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cap.data.set(imageData.data); 

    cv.flip(cap, cap, 1); 

    cv.cvtColor(cap, src, cv.COLOR_RGBA2GRAY, 0); 
    cv.threshold(src, src, 120, 255, cv.THRESH_BINARY_INV); 
    
    let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
    cv.erode(src, src, kernel); 
    kernel.delete();


    // 3. 定义 ROI 和绘制格子
    const ROI_X = canvas.width / 2 - 20;
    const ROI_W = 40; 
    cv.rectangle(cap, new cv.Point(ROI_X, 0), new cv.Point(ROI_X + ROI_W, canvas.height), [0, 255, 0, 255], 2);
    
    const keys = Object.keys(PITCH_MAP).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < GRID_LINES.length; i++) {
        const line = GRID_LINES[i];
        cv.line(cap, new cv.Point(0, line.y), new cv.Point(canvas.width, line.y), [255, 255, 255, 255], 1);
        
        if (i < NUM_STEPS) {
            const center_y = keys[i]; 
            const pitchInfo = PITCH_MAP[center_y];
            if (pitchInfo) {
                cv.putText(cap, pitchInfo.name, new cv.Point(5, pitchInfo.minY + 10), cv.FONT_HERSHEY_SIMPLEX, 0.3, [255, 0, 0, 255], 1);
            }
        }
    }


    // 4. 查找轮廓
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(src, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE); 
    
    let currentPitches = []; 
    let currentNoteNames = [];
    
    // 5. 遍历轮廓并检测是否在 ROI 内
    for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);

        // 面积过滤
        if (area > 100 && area < 4000) { 
            let rect = cv.boundingRect(contour);
            let center_x = rect.x + rect.width / 2;
            let center_y = rect.y + rect.height / 2;
            
            if (center_x >= ROI_X && center_x <= ROI_X + ROI_W) {
                cv.circle(cap, new cv.Point(center_x, center_y), 5, [0, 0, 255, 255], -1); 

                // 6. 精确坐标转音高
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
    
    // 7. 发声逻辑
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