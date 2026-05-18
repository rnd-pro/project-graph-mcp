import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

let HEX_COLOR_RE = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i;
let ACTIONS = ['get', 'validate'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasMetadataArg(args) {
  return Object.prototype.hasOwnProperty.call(args, 'metadata');
}

function getMetadataPath(projectRoot) {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('graph_metadata requires "path" to be a project root path');
  }
  return join(projectRoot, '.portal', 'project-graph.json');
}

function getClusterMatches(cluster) {
  let matches = [
    ...(Array.isArray(cluster.paths) ? cluster.paths : []),
    ...(Array.isArray(cluster.patterns) ? cluster.patterns : []),
    ...(Array.isArray(cluster.nodes) ? cluster.nodes : []),
    ...(Array.isArray(cluster.path) ? cluster.path : []),
    ...(Array.isArray(cluster.pattern) ? cluster.pattern : []),
    ...(Array.isArray(cluster.node) ? cluster.node : []),
  ];

  for (let key of ['path', 'pattern', 'node', 'match']) {
    if (typeof cluster[key] === 'string') {
      matches.push(cluster[key]);
    }
  }

  return matches.map((value) => String(value || '').trim()).filter(Boolean);
}

function validateStringArray(value, pathName, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    errors.push(`${pathName} must be an array of non-empty strings`);
  }
}

function validateStories(value, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('stories must be an array');
    return;
  }

  value.forEach((story, storyIndex) => {
    if (!isObject(story)) {
      errors.push(`stories[${storyIndex}] must be an object`);
      return;
    }
    if (story.id !== undefined && (typeof story.id !== 'string' || story.id.trim() === '')) {
      errors.push(`stories[${storyIndex}].id must be a non-empty string`);
    }
    if (story.label !== undefined && (typeof story.label !== 'string' || story.label.trim() === '')) {
      errors.push(`stories[${storyIndex}].label must be a non-empty string`);
    }
    if (story.description !== undefined && typeof story.description !== 'string') {
      errors.push(`stories[${storyIndex}].description must be a string`);
    }
    if (!Array.isArray(story.beats) || story.beats.length === 0) {
      errors.push(`stories[${storyIndex}].beats must be a non-empty array`);
      return;
    }
    story.beats.forEach((beat, beatIndex) => {
      if (!isObject(beat)) {
        errors.push(`stories[${storyIndex}].beats[${beatIndex}] must be an object`);
        return;
      }
      if (beat.id !== undefined && (typeof beat.id !== 'string' || beat.id.trim() === '')) {
        errors.push(`stories[${storyIndex}].beats[${beatIndex}].id must be a non-empty string`);
      }
      if (beat.label !== undefined && (typeof beat.label !== 'string' || beat.label.trim() === '')) {
        errors.push(`stories[${storyIndex}].beats[${beatIndex}].label must be a non-empty string`);
      }
      if (beat.narrative !== undefined && typeof beat.narrative !== 'string') {
        errors.push(`stories[${storyIndex}].beats[${beatIndex}].narrative must be a string`);
      }
      validateStringArray(beat.nodes, `stories[${storyIndex}].beats[${beatIndex}].nodes`, errors);
      validateStringArray(beat.edges, `stories[${storyIndex}].beats[${beatIndex}].edges`, errors);
      if (beat.clusterId !== undefined && typeof beat.clusterId !== 'string') {
        errors.push(`stories[${storyIndex}].beats[${beatIndex}].clusterId must be a string`);
      }
      if (beat.focusPath !== undefined && typeof beat.focusPath !== 'string') {
        errors.push(`stories[${storyIndex}].beats[${beatIndex}].focusPath must be a string`);
      }
    });
  });
}

export function validateGraphMetadata(metadata) {
  let errors = [];

  if (!isObject(metadata)) {
    return ['metadata must be an object'];
  }

  if (metadata.version !== undefined
    && (!Number.isFinite(Number(metadata.version)) || Number(metadata.version) < 1)) {
    errors.push('version must be a positive number');
  }

  if (metadata.clusters !== undefined && !Array.isArray(metadata.clusters)) {
    errors.push('clusters must be an array');
  }

  if (Array.isArray(metadata.clusters)) {
    for (let index = 0; index < metadata.clusters.length; index++) {
      let cluster = metadata.clusters[index];
      if (!isObject(cluster)) {
        errors.push(`clusters[${index}] must be an object`);
        continue;
      }
      if (getClusterMatches(cluster).length === 0) {
        errors.push(`clusters[${index}] must define at least one path, pattern, node, or match`);
      }
      if (cluster.color !== undefined && !HEX_COLOR_RE.test(String(cluster.color).trim())) {
        errors.push(`clusters[${index}].color must be a hex color`);
      }
    }
  }

  validateStories(metadata.stories, errors);

  for (let key of ['hiddenNodes', 'focusPresets']) {
    if (metadata[key] !== undefined && !Array.isArray(metadata[key])) {
      errors.push(`${key} must be an array`);
    }
  }

  for (let key of ['nodeDescriptions', 'layoutPins']) {
    if (metadata[key] !== undefined && !isObject(metadata[key])) {
      errors.push(`${key} must be an object`);
    }
  }

  return errors;
}

function readMetadata(metadataPath) {
  if (!existsSync(metadataPath)) {
    return {
      found: false,
      metadata: null,
      errors: [],
    };
  }

  try {
    let metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    return {
      found: true,
      metadata,
      errors: validateGraphMetadata(metadata),
    };
  } catch (error) {
    return {
      found: true,
      metadata: null,
      errors: [`failed to read graph metadata at ${metadataPath}: ${error.message}`],
    };
  }
}

export default function graphMetadata(args = {}) {
  if (!ACTIONS.includes(args.action)) {
    throw new Error(`Unknown graph_metadata action "${args.action}". Supported: ${ACTIONS.join(', ')}`);
  }

  let metadataPath = getMetadataPath(args.path);

  if (args.action === 'validate' && hasMetadataArg(args)) {
    return {
      found: true,
      path: metadataPath,
      metadata: args.metadata,
      errors: validateGraphMetadata(args.metadata),
    };
  }

  let result = readMetadata(metadataPath);
  return {
    found: result.found,
    path: metadataPath,
    metadata: result.metadata,
    errors: result.errors,
  };
}
