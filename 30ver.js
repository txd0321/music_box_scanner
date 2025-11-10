// -------------------------------------------------------------------
// 文件: 30ver.js (新增颜色识别，只识别涂成红色的圆点)
// -------------------------------------------------------------------

// --- 全局变量 ---
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
// ... 其他全局变量保持不变 ...
let cap = null;     
let src = null; // 用于最终轮廓
let hsv = null; // 新增：用于HSV颜色空间转换
let isProcessing = false;
let lastDetectedPitches = []; 
let videoStream = null; 

// 🎯 固定 ROI 变量 (保持不变)
const ROI_W = 20;    
let fixedROI_X = 0; 

// 🎨 颜色识别常量 (针对红色)
// 红色在 HSV 空间中跨越 0° (0-180 范围的 0 和 170-180)
// OpenCV 的 H 范围是 0-180 (而不是 0-360)
const LOWER_RED_1 = new cv.Scalar(0, 100, 100);    // 红色低端 1
const UPPER_RED_1 = new cv.Scalar(10, 255, 255);   // 红色高端 1
const LOWER_RED_2 = new cv.Scalar(160, 100, 100);  // 红色低端 2
const UPPER_RED_2 = new cv.Scalar(180, 255, 255);  // 红色高端 2
// **如果选择蓝色，则只需要一个范围：**
// const LOWER_BLUE = new cv.Scalar(100, 100, 100);
// const UPPER_BLUE = new cv.Scalar(130, 255, 255);


// 🎯 Y 轴基准点和音阶定义 (保持不变)
const ANCHOR_TOP_NAME = "ANCHOR_TOP";
const ANCHOR_BOTTOM_NAME = "ANCHOR_BOTTOM";
const TARGET_NOTES_ONLY = [
    { name: "C4", midi: 60 }, 
    // ... (15个音符定义保持不变)
    { name: "B6", midi: 95 }  
];
const NUM_MUSICAL_NOTES = TARGET_NOTES_ONLY.length; 
const NUM_TOTAL_REGIONS = NUM_MUSICAL_NOTES + 2;

let PITCH_MAP = {}; 
let lastTopY = null;
let lastBottomY = null;

// --- (辅助函数、初始化、控制和发声保持不变，仅增加 hsv 的内存清理) ---

function createDynamicGridMap(topY, bottomY, canvasHeight) {
    // ... (函数内容保持不变)
    const fixedTopY = topY !== null ? topY : (lastTopY !== null ? lastTopY : 10);
    const fixedBottomY = bottomY !== null ? bottomY : (lastBottomY !== null ? lastBottomY : canvasHeight - 10);
    
    if (topY !== null && bottomY !== null) { 
        lastTopY = fixedTopY;
        lastBottomY = fixedBottomY;
    }
    
    if (fixedBottomY <= fixedTopY + 5) {
        return;
    }
    
    const actualHeight = fixedBottomY - fixedTopY;
    const actualStepHeight = actualHeight / (NUM_TOTAL_REGIONS - 1); 
    
    const pitchMap = {};
    
    // 顶部基准点
    pitchMap[Math.round(fixedTopY)] = {
        freq: 0, 
        name: ANCHOR_TOP_NAME,
        minY: fixedTopY,
        maxY: fixedTopY + actualStepHeight,
        midY: fixedTopY + actualStepHeight / 2
    };

    // 音乐音符
    for (let i = 0; i < NUM_MUSICAL_NOTES; i++) {
        const note = TARGET_NOTES_ONLY[i];
        
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

    // 底部基准点
    const bottomAnchorLineY = fixedTopY + ((NUM_TOTAL_REGIONS - 1) * actualStepHeight);
    pitchMap[Math.round(bottomAnchorLineY)] = {
        freq: 0, 
        name: ANCHOR_BOTTOM_NAME,
        minY: bottomAnchorLineY,
        maxY: bottomAnchorLineY + actualStepHeight,
        midY: bottomAnchorLineY + actualStepHeight / 2
    };
    
    PITCH_MAP = pitchMap;
}

function initCameraAndAudio() {
    // ... (代码保持不变) ...
        .then(function(stream) {
            videoStream = stream; 
            video.srcObject = stream;
            video.onloadedmetadata = function() {
                video.play();
                
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                fixedROI_X = canvas.width / 2 - ROI_W / 2;
                
                createDynamicGridMap(null, null, canvas.height); 
                
                cap = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
                src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC1);
                hsv = new cv.Mat(); // 🎯 新增初始化
                
                statusElement.innerHTML = '摄像头就绪，开始识别...';
                isProcessing = true;
                
                startButton.disabled = true;
                stopButton.disabled = false; 
                
                requestAnimationFrame(processVideo);
            };
        })
        .catch(function(err) {
    // ... (代码保持不变) ...
}

function stopProcessing() {
    // ... (代码保持不变) ...
    
    if (cap) { cap.delete(); cap = null; }
    if (src) { src.delete(); src = null; }
    if (hsv) { hsv.delete(); hsv = null; } // 🎯 新增内存清理

    if (audioCtx) {
    // ... (代码保持不变) ...
}


// --- 实时图像处理循环 (替换预处理为颜色识别) ---

function processVideo() {
    if (!isProcessing) return;

    // 1. 视频帧采集和颜色预处理
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    cap.data.set(imageData.data); 
    
    // 🎯 颜色识别流水线
    cv.cvtColor(cap, hsv, cv.COLOR_RGBA2HSV);
    
    let mask1 = new cv.Mat();
    let mask2 = new cv.Mat();
    
    // 识别红色范围 1
    let low1 = LOWER_RED_1;
    let high1 = UPPER_RED_1;
    cv.inRange(hsv, low1, high1, mask1);
    
    // 识别红色范围 2 (跨越 0 度)
    let low2 = LOWER_RED_2;
    let high2 = UPPER_RED_2;
    cv.inRange(hsv, low2, high2, mask2);
    
    // 将两个范围的蒙版合并，得到最终的红色蒙版 (src = mask1 | mask2)
    cv.bitwise_or(mask1, mask2, src);
    
    mask1.delete();
    mask2.delete();

    // 形态学操作：腐蚀和膨胀以去除噪点，并连接临近的颜色点
    let kernel = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    cv.erode(src, src, kernel); 
    cv.dilate(src, src, kernel); 
    kernel.delete();


    // 2. 查找轮廓 (现在只在颜色筛选后的图像上进行)
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

        // 面积过滤 (圆点通常不会太大或太小)
        if (area < 50 || area > 5000) { 
            continue;
        }

        let rect = cv.boundingRect(contour);
        
        // 形状过滤 (长宽比和圆度 - 即使有颜色筛选，这些过滤仍然很重要)
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
        
        // 轮廓筛选成功，它是一个合格的红色圆点
        let center_x = rect.x + rect.width / 2;
        let center_y = rect.y + rect.height / 2;
        
        // 🎯 仅检查是否在固定的中央 ROI 内
        if (center_x >= fixedROI_X && center_x <= fixedROI_X + ROI_W) {
            
            // 识别成功的圆点显示为蓝色
            cv.circle(cap, new cv.Point(center_x, center_y), 5, [255, 0, 0, 255], -1); 
            
            // 识别音高和基准点 (使用上一帧的 PITCH_MAP)
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
    
    // 4. 🎯 Y 轴校正：计算新的网格映射
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
    currentPitches = []; 
    currentNoteNames = [];
    
    for (let i = 0; i < contours.size(); ++i) {
        // ... (省略冗余的轮廓过滤，因为在上一步已经做过了)
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        if (area < 50 || area > 5000) continue;
        
        let rect = cv.boundingRect(contour);
        let center_x = rect.x + rect.width / 2;
        let center_y = rect.y + rect.height / 2;

        if (center_x >= fixedROI_X && center_x <= fixedROI_X + ROI_W) {
            for (const key in PITCH_MAP) {
                const pitchInfo = PITCH_MAP[key];
                
                if (pitchInfo.midi === 0) continue; 
                
                if (center_y >= pitchInfo.minY && center_y < pitchInfo.maxY) {
                    currentPitches.push(pitchInfo.freq);
                    currentNoteNames.push(pitchInfo.name);
                    break; 
                }
            }
        }
    }


    // 6. 绘制固定的 ROI (绿色)
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
    if (hsv) hsv.delete(); // 🎯 确保清理
};
