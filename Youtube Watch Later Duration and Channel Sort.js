/**
 * Changelog 2024-02-14
 *  - Added channel sort
 *  - Added increasing scroll delay (scrollLoopTime) to accomodate long lists.
 *  - Added an extra autoscroll call and check for list size changing
 *  - Added an extra scroll in view to show sorting
 *  - Added a recurring hourly option
 *  - More comments
 *
 * Changelog 2023-12-24
 *  - Fixed an issue where recommended videos at the end of the list breaks sorting (due to the lack of reorder anchors)
 *  - Attempted fix for "Upcoming" or any other non-timestamped based videos, sorting to bottom (operating on principle that split(':') will produce at least 2 elements on timestamps)
 *  - Renaming the script to more accurately reflects its capability
 *  - Change license to fit SPDX license list
 *  - Minor code cleanups
 *
 *  Changelog 2023-11-02
 *  - Migrated to a full proper repo to better support discussions, issues and pull requests
 */

/* jshint esversion: 8 */
// ==UserScript==
// @name              Youtube Watch Later Duration and Channel Sort
// @namespace         https://github.com/KohGeek/SortYoutubePlaylistByDuration
// @version           3.1
// @description       As the name implies, sorts youtube playlist by duration and channel
// @author            KohGeek
// @license           GPL-2.0-only
// @icon              https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @match             http://*.youtube.com/playlist*
// @match             https://*.youtube.com/playlist*
// @require           https://greasyfork.org/scripts/374849-library-onelementready-es7/code/Library%20%7C%20onElementReady%20ES7.js
// @supportURL        https://github.com/KohGeek/SortYoutubePlaylistByDuration/
// @grant             none
// @run-at            document-start
// ==/UserScript==

/**
 * Variables and constants
 */
const css =
    `
        .sort-playlist-div {
            font-size: 12px;
            padding: 3px 1px;
        }

        .sort-button-wl {
            border: 1px #a0a0a0;
            border-radius: 2px;
            padding: 3px;
            cursor: pointer;
        }

        .sort-button-wl-default {
            background-color: #30d030;
        }

        .sort-button-wl-stop {
            background-color: #d03030;
        }

        .sort-button-wl-default:active {
            background-color: #209020;
        }

        .sort-button-wl-stop:active {
            background-color: #902020;
        }

        .sort-log {
            padding: 3px;
            margin-top: 3px;
            border-radius: 2px;
            background-color: #202020;
            color: #e0e0e0;
        }

        .sort-margin-right-3px {
            margin-right: 3px;
        }

    `;

const debug = true;

let scrollLoopTime = 500;

let waitTimeAfterDrag = 1800;

const modeAvailable = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

const autoScrollOptions = [
  { value: true, label: "Sort all" },
  { value: false, label: "Sort only loaded" },
];

const sortTypeOptions = [
  { value: "dur", label: "Duration" },
  { value: "chan", label: "Channel" },
];

let sortMode = "asc";

let autoScrollInitialVideoList = true;

let sortType = "dur";


let log = document.createElement("div");
let stopSort = false;

/**
 * Fire a mouse event on an element
 * @param {string=} type
 * @param {Element} elem
 * @param {number} centerX
 * @param {number} centerY
 */
let fireMouseEvent = (type, elem, centerX, centerY) => {
  const event = new MouseEvent(type, {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: centerX,
    clientY: centerY,
  });

  elem.dispatchEvent(event);
};

/**
 * Simulate drag and drop
 * @see: https://ghostinspector.com/blog/simulate-drag-and-drop-javascript-casperjs/
 * @param {Element} elemDrag - Element to drag
 * @param {Element} elemDrop - Element to drop
 */
let simulateDrag = (elemDrag, elemDrop) => {
  // calculate positions
  let pos = elemDrag.getBoundingClientRect();
  let center1X = Math.floor((pos.left + pos.right) / 2);
  let center1Y = Math.floor((pos.top + pos.bottom) / 2);
  pos = elemDrop.getBoundingClientRect();
  let center2X = Math.floor((pos.left + pos.right) / 2);
  let center2Y = Math.floor((pos.top + pos.bottom) / 2);

  // mouse over dragged element and mousedown
  fireMouseEvent("mousemove", elemDrag, center1X, center1Y);
  fireMouseEvent("mouseenter", elemDrag, center1X, center1Y);
  fireMouseEvent("mouseover", elemDrag, center1X, center1Y);
  fireMouseEvent("mousedown", elemDrag, center1X, center1Y);

  // start dragging process over to drop target
  fireMouseEvent("dragstart", elemDrag, center1X, center1Y);
  fireMouseEvent("drag", elemDrag, center1X, center1Y);
  fireMouseEvent("mousemove", elemDrag, center1X, center1Y);
  fireMouseEvent("drag", elemDrag, center2X, center2Y);
  fireMouseEvent("mousemove", elemDrop, center2X, center2Y);

  // trigger dragging process on top of drop target
  fireMouseEvent("mouseenter", elemDrop, center2X, center2Y);
  fireMouseEvent("dragenter", elemDrop, center2X, center2Y);
  fireMouseEvent("mouseover", elemDrop, center2X, center2Y);
  fireMouseEvent("dragover", elemDrop, center2X, center2Y);

  // release dragged element on top of drop target
  fireMouseEvent("drop", elemDrop, center2X, center2Y);
  fireMouseEvent("dragend", elemDrag, center2X, center2Y);
  fireMouseEvent("mouseup", elemDrag, center2X, center2Y);
};

/**
 * Log activities
 * @param {string=} message
 */
let logActivity = (message) => {
  log.innerText = message;
  if (debug) {
    console.log(message);
  }
};

/**
 * For pretty printing times
 */
function str_pad_left(string, pad, length) {
  return (new Array(length + 1).join(pad) + string).slice(-length);
}

/**
 * Generate menu container element
 */
let renderContainerElement = () => {
  const element = document.createElement("div");
  element.className = "sort-playlist sort-playlist-div";
  element.style.paddingBottom = "16px";

  // Add buttonChild container
  const buttonChild = document.createElement("div");
  buttonChild.className = "sort-playlist-div sort-playlist-button";
  element.appendChild(buttonChild);

  // Add selectChild container
  const selectChild = document.createElement("div");
  selectChild.className = "sort-playlist-div sort-playlist-select";
  element.appendChild(selectChild);

  document.querySelector("div.thumbnail-and-metadata-wrapper").append(element);
};

/**
 * Generate button element
 * @param {function} click - OnClick handler
 * @param {string=} label - Button Label
 */
let renderButtonElement = (click = () => {}, label = "", red = false) => {
  // Create button
  const element = document.createElement("button");
  if (red) {
    element.className = "style-scope sort-button-wl sort-button-wl-stop sort-margin-right-3px";
  } else {
    element.className = "style-scope sort-button-wl sort-button-wl-default sort-margin-right-3px";
  }
  element.innerText = label;
  element.onclick = click;

  // Render button
  document.querySelector(".sort-playlist-button").appendChild(element);
};

/**
 * Generate select element
 * @param {number} variable - Variable to update
 * @param {Object[]} options - Options to render
 * @param {string=} label - Select Label
 */
let renderSelectElement = (variable = 0, options = [], label = "") => {
  // Create select
  const element = document.createElement("select");
  element.className = "style-scope sort-margin-right-3px";
  element.onchange = (e) => {
    if (variable === 0) {
      sortMode = e.target.value;
    } else if (variable === 1) {
      autoScrollInitialVideoList = e.target.value;
    } else if (variable === 2) {
      sortType = e.target.value;
    }
  };

  // Create options
  options.forEach((option) => {
    const optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.innerText = option.label;
    element.appendChild(optionElement);
  });

  // Render select
  document.querySelector(".sort-playlist-select").appendChild(element);
};

/**
 * Generate number element
 * @param {number} variable
 * @param {number} defaultValue
 * @param {string=} label
 */
let renderNumberElement = (variable = 0, defaultValue = 0, label = "") => {
  // Create div
  const elementDiv = document.createElement("div");
  elementDiv.className = "sort-playlist-div sort-margin-right-3px";
  elementDiv.innerText = label;

  // Create input
  const element = document.createElement("input");
  element.id = (label.replace(/\s/g, '')).replace(/[^\w\d]/g, '');
  element.type = "number";
  element.value = defaultValue;
  element.className = "style-scope";
  element.oninput = (e) => {
    if (variable === 0) {
      scrollLoopTime = +e.target.value;
      element.id= 'scrollLoopTime_id';
    } else if (variable === 1) {
      waitTimeAfterDrag = +e.target.value;
      element.id= 'waitTimeAfterDrag_id';
    }
  };

  // Render input
  elementDiv.appendChild(element);
  document.querySelector("div.sort-playlist").appendChild(elementDiv);
};

/**
 * Generate log element
 */
let renderLogElement = () => {
  // Populate div
  log.className = "style-scope sort-log";
  log.innerText = "Logging started";

  // Render input
  document.querySelector("div.sort-playlist").appendChild(log);
};

/**
 * Add CSS styling
 */
let addCssStyle = () => {
  const element = document.createElement("style");
  element.innerHTML = css;
  document.head.appendChild(element);
};

/**
 * Scroll automatically to the bottom of the page
 */
let autoScroll = async () => {
  let element = document.scrollingElement;
  let currentScroll = element.scrollTop;
  do {
    currentScroll = element.scrollTop;
    element.scrollTop = element.scrollHeight;
    await new Promise((r) => setTimeout(r, scrollLoopTime));
  } while (currentScroll != element.scrollTop);
};

/**
 * Sort videos by time
 * @param {Element[]} allAnchors - Array of anchors
 * @param {Element[]} allDragPoints - Array of draggable elements
 * @return {number} - Number of videos sorted
 */
let sortVideos = (allAnchors, allDragPoints) => {
  let videos = [];
  let sorted = 0;
  let dragged = false;

  // Sometimes after dragging, the page is not fully loaded yet
  // This can be seen by the number of anchors not being a multiple of 100
  let isFullyLoaded = true;
  if(document.querySelector(".ytd-continuation-item-renderer") !== null) {
      isFullyLoaded = false;
  }
  if (!isFullyLoaded) {
      logActivity("Playlist is not fully loaded. Stopping sort.");
      return 0;
  }

  for (let j = 0; j < allAnchors.length; j++) {
    let thumb = allAnchors[j];
    let drag = allDragPoints[j];

	if(sortType == "dur") {
      let timeSpan = thumb.querySelector("#text");
      let timeDigits = timeSpan.innerText.trim().split(":").reverse();
      let time = parseInt(timeDigits[0]);
      if (timeDigits[1]) time += parseInt(timeDigits[1]) * 60;
      if (timeDigits[2]) time += parseInt(timeDigits[2]) * 3600;
      videos.push({ anchor: drag, time: time, originalIndex: j });
    } else
        if(sortType == "chan"){
			let channelName = 'Unknown';
			try {
            // ! Channel name not always present.  Weird.
				channelName = thumb.querySelector("a.yt-formatted-string").text;
				channelName = ''+ channelName;
			} catch(errChannelName){
				channelName = 'Not Available';
			}
			videos.push({ anchor: drag, channelName: channelName, originalIndex: j });
        }
  }

  // * THIS IS WHERE SORTING ACTUALLY OCCURS
  if (sortMode == "asc") {
      if(sortType == "dur") {
          videos.sort((a, b) => a.time - b.time);
      }
      if(sortType == "chan") {
          videos.sort((a, b) => {
              let nameA = a.channelName.toUpperCase(); // ignore upper and lowercase
              let nameB = b.channelName.toUpperCase(); // ignore upper and lowercase
              if (nameA < nameB) {
                  return -1;
              }
              if (nameA > nameB) {
                  return 1;
              }
              // else names must be equal
              return 0;
          });
      }
  }
  if (sortMode == "desc") {
      if(sortType == "dur") {
          videos.sort((a, b) => b.time - a.time);
      }
      if(sortType == "chan") {
          videos.sort((a, b) => {
              let nameA = a.channelName.toUpperCase(); // ignore upper and lowercase
              let nameB = b.channelName.toUpperCase(); // ignore upper and lowercase
              if (nameA > nameB) {
                  return -1;
              }
              return 0;
          });
      }
  }

  for (let j = 0; j < videos.length; j++) {
    let originalIndex = videos[j].originalIndex;

    if (debug) console.log("--" + "loaded " + videos.length + " videos. Comparing video " + j + " to video " + originalIndex + ".");

    if (originalIndex !== j) {
      let elemDrag = videos[j].anchor;
      let elemDrop = videos.find((v) => v.originalIndex === j).anchor;

      let finalTime = '00:00:00';
      if(videos[j].time) {
          let aTime = videos[j].time;
          let aHours = Math.floor(aTime / 3600);
          aTime = aTime - (aHours * 3600);
          let aMinutes = Math.floor(aTime / 60);
          let aSeconds = aTime - (aMinutes * 60);
          finalTime = str_pad_left(aHours, '0', 2) + ':' + str_pad_left(aMinutes, '0', 2) + ':' + str_pad_left(aSeconds, '0', 2);
      }
      logActivity("Dragging video #" + originalIndex + " " + (videos[j].time ? finalTime : videos[j].channelName) + " to position #" + j);
      simulateDrag(elemDrag, elemDrop);
      dragged = true;
      if (debug) console.log("--" + "dragged video " + originalIndex + " " + (videos[j].time ?? videos[j].channelName) + " to position " + j);

      // * have to show the sorting!
      elemDrop.scrollIntoView({ behavior: "instant", block: "end", inline: "nearest" });
      if (debug) console.log("--" + "scrolled video " + j + " into view");
    }
    sorted = j;
    if (stopSort || dragged) break;
  }
  return sorted;
};

/**
 * There is an inherent limit in how fast you can sort the videos,
 * due to Youtube refreshing. This limit also applies if you do it manually.
 * It is also much worse if you have a lot of videos.
 * For every 100 videos, it's about an extra 2-4 seconds, maybe longer!
 */
let activateSort = async () => {
    let allAnchors = document.querySelectorAll("div#content a#thumbnail.inline-block.ytd-thumbnail");
    let allDragPoints;

    let sortedCount = 0;
    let initialVideoCount = allAnchors.length;
    stopSort = false;

    while (
        /**
         * if we are on the playlist page
         * and the sort is not cancelled
         * and autoscrolling is on i.e. sort all
         * and the loading spinner is present
         */
        document.URL.includes("playlist?list=")
        && stopSort === false
        && autoScrollInitialVideoList === true
        && document.querySelector(".ytd-continuation-item-renderer") !== null) {
        logActivity("Loading more videos" + " - " + allAnchors.length + " videos loaded");

        if (allAnchors.length > 300) {
            logActivity(log.innerText + "\nNumber of videos loaded is high, sorting may take a long time");
        } else if (allAnchors.length > 600) {
            logActivity(log.innerText + "\nSorting may take extremely long time/is likely to bug out");
        }

        await autoScroll();
        allAnchors = document.querySelectorAll("div#content a#thumbnail.inline-block.ytd-thumbnail");
        initialVideoCount = allAnchors.length;
    }
    // * Now all videos are loaded
    logActivity(initialVideoCount + " videos loaded.");

    let revisedVideoCount = initialVideoCount;

    // * Next we sort (in memory)
    while (sortedCount < revisedVideoCount && stopSort === false) {
        if(autoScrollInitialVideoList == true) await autoScroll();

        if(sortType == "dur") {
            allAnchors = document.querySelectorAll("div#content a#thumbnail.inline-block.ytd-thumbnail");
        } else if(sortType == "chan") {
            allAnchors = document.querySelectorAll("div#content div#byline-container");
        }
        allDragPoints = document.querySelectorAll("yt-icon#reorder");

        // * lazy loading can increase number of videos
        if(autoScrollInitialVideoList == true) revisedVideoCount = allAnchors.length;
        if (debug) console.log("--" + "revised video count is " + revisedVideoCount);
        if (debug) console.log("--" + "sorted video count is " + sortedCount);

        let anchorListLength = allAnchors.length;
        if (!allAnchors[anchorListLength - 1].querySelector("#text")) {
            logActivity("Video " + anchorListLength + " is not loaded yet, waiting... " + waitTimeAfterDrag + "ms");
            await new Promise((r) => setTimeout(r, waitTimeAfterDrag));
            continue;
        }

        // * ...and actually invoke the sort!
        let numSorted = sortVideos(allAnchors, allDragPoints);

        sortedCount = numSorted + 1; //always advance to prevent race
        if(numSorted > 0) {
            await new Promise((r) => setTimeout(r, waitTimeAfterDrag));
        } else { //numSorted == 0, no videos were sorted, waiting playlist lazy loading to sort all
            if (debug) console.log("--" + "no videos were sorted, awaiting playlist lazy loading");
            scrollLoopTime = scrollLoopTime + 100;
            try { document.querySelector("#ScrollDelayms").value = scrollLoopTime; } catch(err){};
            await new Promise((r) => setTimeout(r, waitTimeAfterDrag + scrollLoopTime));
        }
    }

    if (stopSort === true) {
        logActivity("Sort cancelled.  Stopping.");
        stopSort = false;
    } else {
        logActivity("Sort complete. Video sorted: " + sortedCount + ".  Stopping.");
    }
};

/**
 * Initialise script - IIFE
 */
var hourlyInt;
{
    onElementReady("div.thumbnail-and-metadata-wrapper", false, () => {
        renderContainerElement();
        addCssStyle();
        renderButtonElement(activateSort, "Sort Videos", false);
        renderButtonElement(() => { hourlyInt = setInterval(activateSort, 3600000)}, "Hourly Sort", false);
        renderButtonElement(() => { clearInterval(hourlyInt); stopSort = true; }, "Stop Sort", true);
        renderSelectElement(0, modeAvailable, "Sort Mode");
        renderSelectElement(1, autoScrollOptions, "Auto Scroll");
        renderSelectElement(2, sortTypeOptions, 'Sort Type');
        renderNumberElement(0, scrollLoopTime, 'Scroll Delay (ms)');
        renderNumberElement(1, waitTimeAfterDrag, "Wait Time After Drag (ms)");
        renderLogElement();
    });
}

