/*!
 * mustache.js - Logic-less {{mustache}} templates with JavaScript
 * http://github.com/janl/mustache.js
 */

let objectToString = Object.prototype.toString;
let isArray = Array.isArray || function isArrayPolyfill (object) {
  return objectToString.call(object) === '[object Array]';
};

function isFunction (object) {
  return typeof object === 'function';
}

/**
 * More correct typeof string handling array
 * which normally returns typeof 'object'
 */
function typeStr (obj) {
  return isArray(obj) ? 'array' : typeof obj;
}

function escapeRegExp (string) {
  return string.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, '\\$&');
}

/**
 * Null safe way of checking whether or not an object,
 * including its prototype, has a given property
 */
function hasProperty (obj, propName) {
  return obj != null && typeof obj === 'object' && (propName in obj);
}

/**
 * Safe way of detecting whether or not the given thing is a primitive and
 * whether it has the given property
 */
function primitiveHasOwnProperty (primitive, propName) {
  return (
    primitive != null
    && typeof primitive !== 'object'
    && primitive.hasOwnProperty
    && primitive.hasOwnProperty(propName)
  );
}

// Workaround for https://issues.apache.org/jira/browse/COUCHDB-577
// See https://github.com/janl/mustache.js/issues/189
let regExpTest = RegExp.prototype.test;
function testRegExp (re, string) {
  return regExpTest.call(re, string);
}

let nonSpaceRe = /\S/;
function isWhitespace (string) {
  return !testRegExp(nonSpaceRe, string);
}

let entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

function escapeHtml (string) {
  return String(string).replace(/[&<>"'`=\/]/g, function fromEntityMap (s) {
    return entityMap[s];
  });
}

let whiteRe = /\s*/;
let spaceRe = /\s+/;
let equalsRe = /\s*=/;
let curlyRe = /\s*\}/;
let tagRe = /#|\^|\/|>|\{|&|=|!/;

/**
 * Breaks up the given `template` string into a tree of tokens. If the `tags`
 * argument is given here it must be an array with two string values: the
 * opening and closing tags used in the template (e.g. [ "<%", "%>" ]). Of
 * course, the default is to use mustaches (i.e. mustache.tags).
 *
 * A token is an array with at least 4 elements. The first element is the
 * mustache symbol that was used inside the tag, e.g. "#" or "&". If the tag
 * did not contain a symbol (i.e. {{myValue}}) this element is "name". For
 * all text that appears outside a symbol this element is "text".
 *
 * The second element of a token is its "value". For mustache tags this is
 * whatever else was inside the tag besides the opening symbol. For text tokens
 * this is the text itself.
 *
 * The third and fourth elements of the token are the start and end indices,
 * respectively, of the token in the original template.
 *
 * Tokens that are the root node of a subtree contain two more elements: 1) an
 * array of tokens in the subtree and 2) the index in the original template at
 * which the closing tag for that section begins.
 *
 * Tokens for partials also contain two more elements: 1) a string value of
 * indendation prior to that tag and 2) the index of that tag on that line -
 * eg a value of 2 indicates the partial is the third tag on this line.
 */
function parseTemplate (template, tags) {
  if (!template)
    return [];
  let lineHasNonSpace = false;
  let sections = [];     // Stack to hold section tokens
  let tokens = [];       // Buffer to hold the tokens
  let spaces = [];       // Indices of whitespace tokens on the current line
  let hasTag = false;    // Is there a {{tag}} on the current line?
  let nonSpace = false;  // Is there a non-space char on the current line?
  let indentation = '';  // Tracks indentation for tags that use it
  let tagIndex = 0;      // Stores a count of number of tags encountered on a line

  // Strips all whitespace tokens array for the current line
  // if there was a {{#tag}} on it and otherwise only space.
  function stripSpace () {
    if (hasTag && !nonSpace) {
      while (spaces.length)
        delete tokens[spaces.pop()];
    } else {
      spaces = [];
    }

    hasTag = false;
    nonSpace = false;
  }

  let openingTagRe, closingTagRe, closingCurlyRe;
  function compileTags (tagsToCompile) {
    if (typeof tagsToCompile === 'string')
      tagsToCompile = tagsToCompile.split(spaceRe, 2);

    if (!isArray(tagsToCompile) || tagsToCompile.length !== 2)
      throw new Error('Invalid tags: ' + tagsToCompile);

    openingTagRe = new RegExp(escapeRegExp(tagsToCompile[0]) + '\\s*');
    closingTagRe = new RegExp('\\s*' + escapeRegExp(tagsToCompile[1]));
    closingCurlyRe = new RegExp('\\s*' + escapeRegExp('}' + tagsToCompile[1]));
  }

  compileTags(tags || mustache.tags);

  let scanner = new Scanner(template);

  let start, type, value, chr, token, openSection;
  while (!scanner.eos()) {
    start = scanner.pos;

    // Match any text between tags.
    value = scanner.scanUntil(openingTagRe);

    if (value) {
      for (let i = 0, valueLength = value.length; i < valueLength; ++i) {
        chr = value.charAt(i);

        if (isWhitespace(chr)) {
          spaces.push(tokens.length);
          indentation += chr;
        } else {
          nonSpace = true;
          lineHasNonSpace = true;
          indentation += ' ';
        }

        tokens.push([ 'text', chr, start, start + 1 ]);
        start += 1;

        // Check for whitespace on the current line.
        if (chr === '\n') {
          stripSpace();
          indentation = '';
          tagIndex = 0;
          lineHasNonSpace = false;
        }
      }
    }

    // Match the opening tag.
    if (!scanner.scan(openingTagRe))
      break;

    hasTag = true;

    // Get the tag type.
    type = scanner.scan(tagRe) || 'name';
    scanner.scan(whiteRe);

    // Get the tag value.
    if (type === '=') {
      value = scanner.scanUntil(equalsRe);
      scanner.scan(equalsRe);
      scanner.scanUntil(closingTagRe);
    } else if (type === '{') {
      value = scanner.scanUntil(closingCurlyRe);
      scanner.scan(curlyRe);
      scanner.scanUntil(closingTagRe);
      type = '&';
    } else {
      value = scanner.scanUntil(closingTagRe);
    }

    // Match the closing tag.
    if (!scanner.scan(closingTagRe))
      throw new Error('Unclosed tag at ' + scanner.pos);

    if (type == '>') {
      token = [ type, value, start, scanner.pos, indentation, tagIndex, lineHasNonSpace ];
    } else {
      token = [ type, value, start, scanner.pos ];
    }
    tagIndex++;
    tokens.push(token);

    if (type === '#' || type === '^') {
      sections.push(token);
    } else if (type === '/') {
      // Check section nesting.
      openSection = sections.pop();

      if (!openSection)
        throw new Error('Unopened section "' + value + '" at ' + start);

      if (openSection[1] !== value)
        throw new Error('Unclosed section "' + openSection[1] + '" at ' + start);
    } else if (type === 'name' || type === '{' || type === '&') {
      nonSpace = true;
    } else if (type === '=') {
      // Set the tags for the next time around.
      compileTags(value);
    }
  }

  stripSpace();

  // Make sure there are no open sections when we're done.
  openSection = sections.pop();

  if (openSection)
    throw new Error('Unclosed section "' + openSection[1] + '" at ' + scanner.pos);

  return nestTokens(squashTokens(tokens));
}

/**
 * Combines the values of consecutive text tokens in the given `tokens` array
 * to a single token.
 */
function squashTokens (tokens) {
  let squashedTokens = [];

  let token, lastToken;
  for (let i = 0, numTokens = tokens.length; i < numTokens; ++i) {
    token = tokens[i];

    if (token) {
      if (token[0] === 'text' && lastToken && lastToken[0] === 'text') {
        lastToken[1] += token[1];
        lastToken[3] = token[3];
      } else {
        squashedTokens.push(token);
        lastToken = token;
      }
    }
  }

  return squashedTokens;
}

/**
 * Forms the given array of `tokens` into a nested tree structure where
 * tokens that represent a section have two additional items: 1) an array of
 * all tokens that appear in that section and 2) the index in the original
 * template that represents the end of that section.
 */
function nestTokens (tokens) {
  let nestedTokens = [];
  let collector = nestedTokens;
  let sections = [];

  let token, section;
  for (let i = 0, numTokens = tokens.length; i < numTokens; ++i) {
    token = tokens[i];

    switch (token[0]) {
      case '#':
      case '^':
        collector.push(token);
        sections.push(token);
        collector = token[4] = [];
        break;
      case '/':
        section = sections.pop();
        section[5] = token[2];
        collector = sections.length > 0 ? sections[sections.length - 1][4] : nestedTokens;
        break;
      default:
        collector.push(token);
    }
  }

  return nestedTokens;
}

/**
 * A simple string scanner that is used by the template parser to find
 * tokens in template strings.
 */
function Scanner (string) {
  this.string = string;
  this.tail = string;
  this.pos = 0;
}

/**
 * Returns `true` if the tail is empty (end of string).
 */
Scanner.prototype.eos = function eos () {
  return this.tail === '';
};

/**
 * Tries to match the given regular expression at the current position.
 * Returns the matched text if it can match, the empty string otherwise.
 */
Scanner.prototype.scan = function scan (re) {
  let match = this.tail.match(re);

  if (!match || match.index !== 0)
    return '';

  const string = match[0];

  this.tail = this.tail.substring(string.length);
  this.pos += string.length;

  return string;
};

/**
 * Skips all text until the given regular expression can be matched. Returns
 * the skipped string, which is the entire tail if no match can be made.
 */
Scanner.prototype.scanUntil = function scanUntil (re) {
  const index = this.tail.search(re)
  let match;

  switch (index) {
    case -1:
      match = this.tail;
      this.tail = '';
      break;
    case 0:
      match = '';
      break;
    default:
      match = this.tail.substring(0, index);
      this.tail = this.tail.substring(index);
  }

  this.pos += match.length;

  return match;
};

/**
 * Represents a rendering context by wrapping a view object and
 * maintaining a reference to the parent context.
 */
function Context (view, parentContext) {
  this.view = view;
  this.cache = { '.': this.view };
  this.parent = parentContext;
}

/**
 * Creates a new context using the given view with this context
 * as the parent.
 */
Context.prototype.push = function push (view) {
  return new Context(view, this);
};

/**
 * Returns the value of the given name in this context, traversing
 * up the context hierarchy if the value is absent in this context's view.
 */
Context.prototype.lookup = function lookup (name) {
  const cache = this.cache;

  let value;
  if (cache.hasOwnProperty(name)) {
    value = cache[name];
  } else {
    let context = this, intermediateValue, names, index, lookupHit = false;

    while (context) {
      if (name.indexOf('.') > 0) {
        intermediateValue = context.view;
        names = name.split('.');
        index = 0;

        /**
         * Using the dot notion path in `name`, we descend through the
         * nested objects.
         *
         * To be certain that the lookup has been successful, we have to
         * check if the last object in the path actually has the property
         * we are looking for. We store the result in `lookupHit`.
         *
         * This is specially necessary for when the value has been set to
         * `undefined` and we want to avoid looking up parent contexts.
         *
         * In the case where dot notation is used, we consider the lookup
         * to be successful even if the last "object" in the path is
         * not actually an object but a primitive (e.g., a string, or an
         * integer), because it is sometimes useful to access a property
         * of an autoboxed primitive, such as the length of a string.
         **/
        while (intermediateValue != null && index < names.length) {
          if (index === names.length - 1)
            lookupHit = (
              hasProperty(intermediateValue, names[index])
              || primitiveHasOwnProperty(intermediateValue, names[index])
            );

          intermediateValue = intermediateValue[names[index++]];
        }
      } else {
        intermediateValue = context.view[name];

        /**
         * Only checking against `hasProperty`, which always returns `false` if
         * `context.view` is not an object. Deliberately omitting the check
         * against `primitiveHasOwnProperty` if dot notation is not used.
         *
         * Consider this example:
         * ```
         * Mustache.render("The length of a football field is {{#length}}{{length}}{{/length}}.", {length: "100 yards"})
         * ```
         *
         * If we were to check also against `primitiveHasOwnProperty`, as we do
         * in the dot notation case, then render call would return:
         *
         * "The length of a football field is 9."
         *
         * rather than the expected:
         *
         * "The length of a football field is 100 yards."
         **/
        lookupHit = hasProperty(context.view, name);
      }

      if (lookupHit) {
        value = intermediateValue;
        break;
      }

      context = context.parent;
    }

    cache[name] = value;
  }

  if (isFunction(value))
    value = value.call(this.view);

  return value;
};

/**
 * A Writer knows how to take a stream of tokens and render them to a
 * string, given a context. It also maintains a cache of templates to
 * avoid the need to parse the same template twice.
 */
function Writer () {
  this.templateCache = {
    _cache: {},
    set: function set (key, value) {
      this._cache[key] = value;
    },
    get: function get (key) {
      return this._cache[key];
    },
    clear: function clear () {
      this._cache = {};
    }
  };
}

/**
 * Clears all cached templates in this writer.
 */
Writer.prototype.clearCache = function clearCache () {
  if (typeof this.templateCache !== 'undefined') {
    this.templateCache.clear();
  }
  return;
};

/**
 * Parses and caches the given `template` according to the given `tags` or
 * `mustache.tags` if `tags` is omitted,  and returns the array of tokens
 * that is generated from the parse.
 */
Writer.prototype.parse = function parse (template, tags) {
  const cache = this.templateCache;
  const cacheKey = template + ':' + (tags || mustache.tags).join(':');
  const isCacheEnabled = typeof cache !== 'undefined';
  let tokens = isCacheEnabled ? cache.get(cacheKey) : undefined;

  if (tokens == undefined) {
    tokens = parseTemplate(template, tags);
    isCacheEnabled && cache.set(cacheKey, tokens);
  }
  return tokens;
};

/**
 * High-level method that is used to render the given `template` with
 * the given `view`.
 *
 * The optional `partials` argument may be an object that contains the
 * names and templates of partials that are used in the template. It may
 * also be a function that is used to load partial templates on the fly
 * that takes a single argument: the name of the partial.
 *
 * If the optional `config` argument is given here, then it should be an
 * object with a `tags` attribute or an `escape` attribute or both.
 * If an array is passed, then it will be interpreted the same way as
 * a `tags` attribute on a `config` object.
 *
 * The `tags` attribute of a `config` object must be an array with two
 * string values: the opening and closing tags used in the template (e.g.
 * [ "<%", "%>" ]). The default is to mustache.tags.
 *
 * The `escape` attribute of a `config` object must be a function which
 * accepts a string as input and outputs a safely escaped string.
 * If an `escape` function is not provided, then an HTML-safe string
 * escaping function is used as the default.
 */
Writer.prototype.render = function render (template, view, partials, config) {
  const tags = this.getConfigTags(config);
  const tokens = this.parse(template, tags);
  const context = (view instanceof Context) ? view : new Context(view, undefined);
  return this.renderTokens(tokens, context, partials, template, config);
};

/**
 * Low-level method that renders the given array of `tokens` using
 * the given `context` and `partials`.
 *
 * Note: The `originalTemplate` is only ever used to extract the portion
 * of the original template that was contained in a higher-order section.
 * If the template doesn't use higher-order sections, this argument may
 * be omitted.
 */
Writer.prototype.renderTokens = function renderTokens (tokens, context, partials, originalTemplate, config) {
  let buffer = "";
  for (let i = 0, numTokens = tokens.length; i < numTokens; ++i) {
    const value = this.unescapedValue(tokens[i], context);
    if (value !== undefined) buffer += value;
  }
  return buffer;
};

// FORK-CHANGE: I changed all "var" to "let" and "const" the way they are required or not

// FORK-CHANGE : at mivator we don#t need any special var symbols, therefore no checks are required, we can also get rid of the other render functions
// That's why renderTokens is adjusted

/*
Writer.prototype.renderTokens = function renderTokens (tokens, context, partials, originalTemplate, config) {
  let buffer = '';

  let token, symbol, value;
  for (let i = 0, numTokens = tokens.length; i < numTokens; ++i) {
    value = undefined;
    token = tokens[i];
    symbol = token[0];

    if (symbol === '#') value = this.renderSection(token, context, partials, originalTemplate, config);
    else if (symbol === '^') value = this.renderInverted(token, context, partials, originalTemplate, config);
    else if (symbol === '>') value = this.renderPartial(token, context, partials, config);
    else if (symbol === '&') value = this.unescapedValue(token, context);
    else if (symbol === 'name') value = this.escapedValue(token, context, config);
    else if (symbol === 'text') value = this.rawValue(token);

    if (value !== undefined)
      buffer += value;
  }

  return buffer;
};

Writer.prototype.renderSection = function renderSection (token, context, partials, originalTemplate, config) {
  let self = this;
  let buffer = '';
  let value = context.lookup(token[1]);

  // This function is used to render an arbitrary template
  // in the current context by higher-order sections.
  function subRender (template) {
    return self.render(template, context, partials, config);
  }

  if (!value) return;

  if (isArray(value)) {
    for (let j = 0, valueLength = value.length; j < valueLength; ++j) {
      buffer += this.renderTokens(token[4], context.push(value[j]), partials, originalTemplate, config);
    }
  } else if (typeof value === 'object' || typeof value === 'string' || typeof value === 'number') {
    buffer += this.renderTokens(token[4], context.push(value), partials, originalTemplate, config);
  } else if (isFunction(value)) {
    if (typeof originalTemplate !== 'string')
      throw new Error('Cannot use higher-order sections without the original template');

    // Extract the portion of the original template that the section contains.
    value = value.call(context.view, originalTemplate.slice(token[3], token[5]), subRender);

    if (value != null)
      buffer += value;
  } else {
    buffer += this.renderTokens(token[4], context, partials, originalTemplate, config);
  }
  return buffer;
};

Writer.prototype.renderInverted = function renderInverted (token, context, partials, originalTemplate, config) {
  let value = context.lookup(token[1]);

  // Use JavaScript's definition of falsy. Include empty arrays.
  // See https://github.com/janl/mustache.js/issues/186
  if (!value || (isArray(value) && value.length === 0))
    return this.renderTokens(token[4], context, partials, originalTemplate, config);
};

Writer.prototype.indentPartial = function indentPartial (partial, indentation, lineHasNonSpace) {
  let filteredIndentation = indentation.replace(/[^ \t]/g, '');
  let partialByNl = partial.split('\n');
  for (let i = 0; i < partialByNl.length; i++) {
    if (partialByNl[i].length && (i > 0 || !lineHasNonSpace)) {
      partialByNl[i] = filteredIndentation + partialByNl[i];
    }
  }
  return partialByNl.join('\n');
};

Writer.prototype.renderPartial = function renderPartial (token, context, partials, config) {
  if (!partials) return;
  let tags = this.getConfigTags(config);

  let value = isFunction(partials) ? partials(token[1]) : partials[token[1]];
  if (value != null) {
    let lineHasNonSpace = token[6];
    let tagIndex = token[5];
    let indentation = token[4];
    let indentedValue = value;
    if (tagIndex == 0 && indentation) {
      indentedValue = this.indentPartial(value, indentation, lineHasNonSpace);
    }
    let tokens = this.parse(indentedValue, tags);
    return this.renderTokens(tokens, context, partials, indentedValue, config);
  }
};

Writer.prototype.escapedValue = function escapedValue (token, context, config) {
  let escape = this.getConfigEscape(config) || mustache.escape;
  let value = context.lookup(token[1]);
  if (value != null)
    return (typeof value === 'number' && escape === mustache.escape) ? String(value) : escape(value);
};

Writer.prototype.rawValue = function rawValue (token) {
  return token[1];
};

*/

// FORK-CHANGE : Changed the way of void return to undefined if null
Writer.prototype.unescapedValue = function unescapedValue (token, context) {
  const value = context.lookup(token[1]);
  return value != null ? value : undefined;
};


Writer.prototype.getConfigTags = function getConfigTags (config) {
  if (isArray(config)) {
    return config;
  }
  else if (config && typeof config === 'object') {
    return config.tags;
  }
  else {
    return undefined;
  }
};

Writer.prototype.getConfigEscape = function getConfigEscape (config) {
  if (config && typeof config === 'object' && !isArray(config)) {
    return config.escape;
  }
  else {
    return undefined;
  }
};


let mustache = {
  name: 'mustache.js',
  version: '4.2.1-fork-mivator',
  tags: [ '{', '}' ],
  clearCache: undefined,
  escape: undefined,
  parse: undefined,
  render: undefined,
  Scanner: undefined,
  Context: undefined,
  Writer: undefined,
  /**
   * Allows a user to override the default caching strategy, by providing an
   * object with set, get and clear methods. This can also be used to disable
   * the cache by setting it to the literal `undefined`.
   */
  set templateCache (cache) {
    defaultWriter.templateCache = cache;
  },
  /**
   * Gets the default or overridden caching object from the default writer.
   */
  get templateCache () {
    return defaultWriter.templateCache;
  }
};

// All high-level mustache.* functions use this writer.
let defaultWriter = new Writer();

/**
 * Clears all cached templates in the default writer.
 */
mustache.clearCache = function clearCache () {
  return defaultWriter.clearCache();
};

/**
 * Parses and caches the given template in the default writer and returns the
 * array of tokens it contains. Doing this ahead of time avoids the need to
 * parse templates on the fly as they are rendered.
 */
mustache.parse = function parse (template, tags) {
  return defaultWriter.parse(template, tags);
};

/**
 * Renders the `template` with the given `view`, `partials`, and `config`
 * using the default writer.
 */
mustache.render = function render (template, view, partials, config) {
  if (typeof template !== 'string') {
    throw new TypeError('Invalid template! Template should be a "string" ' +
                        'but "' + typeStr(template) + '" was given as the first ' +
                        'argument for mustache#render(template, view, partials)');
  }

  return defaultWriter.render(template, view, partials, config);
};

// Export the escaping function so that the user may override it.
// See https://github.com/janl/mustache.js/issues/244
mustache.escape = escapeHtml;

// Export these mainly for testing, but also for advanced usage.
mustache.Scanner = Scanner;
mustache.Context = Context;
mustache.Writer = Writer;

export default mustache;