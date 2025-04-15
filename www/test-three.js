// Simple script to test THREE.js loading

console.log("Testing THREE.js loading...");

import * as THREE from 'three';

console.log("THREE version:", THREE.REVISION);

// Create a simple object to verify THREE is working
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const renderer = new THREE.WebGLRenderer();

console.log("THREE.js loaded successfully!");