
var _ = require('lodash'),
	Promise = require('bluebird'),
	path = require('path'),
	fs = require('fs'),
	loaderUtils = require('loader-utils'),
	multiplex = require('option-multiplexer'),
	ttf2eot = require('ttf2eot'),
	ttf2woff = require('ttf2woff');

var template = _.template(fs.readFileSync(path.join(__dirname, '..', 'share', 'font.template')));

var extensions = {
	'.woff': 'woff',
	'.ttf': 'truetype',
	'.eot': 'embedded-opentype',
	'.svg': 'svg',
	'.otf': 'opentype'
};

var convertors = {
	'truetype': {
		'woff': function(font, data) {
			return ttf2woff(data, { }).buffer;
		},
		'embedded-opentype': function(font, data) {
			return ttf2eot(data, { }).buffer;
		},
		'opentype': function(font, data) {
			return data;
		}
	},
	'opentype': {
		'woff': function(font, data) {
			return ttf2woff(data, { }).buffer;
		},
		'embedded-opentype': function(font, data) {
			return ttf2eot(data, { }).buffer;
		},
		'truetype': function(font, data) {
			return data;
		}
	}
};

var formats = _.invert(extensions);

function getDefaultFormat(ext) {
	return extensions[ext];
}

function getExtension(format) {
	return formats[format];
}

function createTargets(source, options) {
	options = _.defaults(_.pick(options, 'weight', 'style', 'format'), {
		weight: _.chain(source).pluck('weight').uniq().value(),
		style: _.chain(source).pluck('style').uniq().value(),
		format: _.chain(source).pluck('format').uniq().value()
	});
	return multiplex(options);
}

function groupFaces(meta, fonts) {
	return _.chain(fonts)
		.groupBy(function(font) {
			return JSON.stringify(_.pick(font, 'weight', 'style'))
		}).map(function(members, key) {
			var props = JSON.parse(key);
			return _.assign(props, {
				name: meta.name,
				files: members
			});
		})
		.value();
}

module.exports = function(input) {

	var _this = this,
		meta = JSON.parse(input),
		query = loaderUtils.parseQuery(this.query),
		base = this.context,
		callback = this.async();

	function interpolateName(path, font) {
		return loaderUtils.interpolateName(_this, path, {
			name: font.name,
			context: query.context || _this.options.context,
			content: font.data,
			regExp: query.regExp
		});
	}

	function emit(font) {
		var name = interpolateName('[name].[hash:8]' + getExtension(font.format), font);
		_this.emitFile(name, font.data);
		return name;
	}

	this.cacheable();

	var targets, results;


	function defaults(file) {
		_.defaults(file, {
			weight: 500,
			format: getDefaultFormat(path.extname(file.file)),
			style: 'regular',
			data: new Promise(function filePromise(resolve, reject) {
				fs.readFile(path.join(base, file.file), function fileLoaded(err, data) {
					return err ? reject(err) : resolve(data);
				});
			})
		});
	}

	_.forEach(meta.files, defaults);
	targets = createTargets(meta.files, query);

	results = _.map(targets, function processTarget(target) {
		var search = _.pick(target, 'weight', 'style'),
			source = _.find(meta.files, search);
		if (!source) {
			return Promise.reject('No matching source to ' + query + '.');
		}
		return source.data.then(function dataLoaded(data) {
			return _.assign({
				data: source.format === target.format ?
					data :
					convertors[source.format][target.format](target, data)
			}, target);
		}).then(function emitFont(font) {
			font.file = emit(font);
			return font;
		});
	});

	Promise.all(results).then(function fontsGenerated(fonts) {
		var faces = groupFaces(meta, fonts);
		callback(null, template({ faces: faces }));
	}).catch(function errored(err) {
		callback(err);
	});
};