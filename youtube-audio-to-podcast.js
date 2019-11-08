const fs = require("fs")
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const config = require('nodejs-config')(
	__dirname
);
var m = module.exports = {};

m.getPodcastItemsByChannelId = function(channelId, enclosureUrlTpl, cb) {
	var {google} = require('googleapis');
	
	var _ = require('underscore');
	var yt = google.youtube('v3');

	yt.search.list({
		part: 'id,snippet',
		channelId: channelId,
		key: config.get('local.youtubeApiKey'),
		maxResults: 50,
		order: 'date', // descending date order is important for a podcast
		type: 'video',
	}, function(err, list) {
		// Pull out the relevant items for our podcast RSS
		var items = list.data.items;

		// Map into our desired format
		items = _.map(items, function(item) {
			// sync to save audio
			saveAudioFile(item.id.videoId);
			return {
				title: item.snippet.title,
				description: item.snippet.description,
				url: 'http://youtu.be/'+item.id.videoId,
				date: item.snippet.publishedAt,
				enclosure: {
					url: enclosureUrlTpl.replace('[videoId]', item.id.videoId),
					type: 'audio/mpeg',
				}
			};
		});

		cb(items);
	});
}

m.getChannelInfoById = function(channelId, feedUrl, cb) {
	var {google} = require('googleapis');
	var yt = google.youtube('v3');

	return yt.channels.list({
		part: 'id,snippet',
		id: channelId,
		key: config.get('local.youtubeApiKey')
	}, function(err, list) {
		var channel = list.data.items[0];
		var ret = {};

		if (!channel) return;

		ret[channel.id] = {
			title: channel.snippet.title,
			description: channel.snippet.description,
			feed_url: feedUrl,
			site_url: "http://youtube.com/channel/"+channel.id,
			image_url: channel.snippet.thumbnails.default.url,
		};
		cb(ret);
	});
}

m.getChannelInfoByUsername = function(username, feedUrl, cb) {
	var {google} = require('googleapis');
	var yt = google.youtube('v3');

	return yt.channels.list({
		part: 'id,snippet',
		forUsername: username,
		key: config.get('local.youtubeApiKey')
	}, function(err, list) {
		var channel = list.data.items[0];
		var ret = {};

		if (!channel) return;

		ret[channel.id] = {
			title: channel.snippet.title,
			description: channel.snippet.description,
			feed_url: feedUrl,
			site_url: "http://youtube.com/channel/"+channel.id,
			image_url: channel.snippet.thumbnails.default.url,
		};
		cb(ret);
	});
}

m.getPodcastRssXml = function(info, items) {
	var rss = require('rss');
	var _ = require('underscore');

	var feed = new rss(info);
	_.each(items, function(item) {
		feed.item(item);
	});

	return feed.xml();
}

m.getPodcastRssXmlByUsername = function(username, feedUrl, enclosureUrlTpl, cb) {
	m.getChannelInfoByUsername(username, feedUrl, function(info) {
		// Get the channel id
		for (var channelId in info) { continue; }

		m.getPodcastItemsByChannelId(channelId, enclosureUrlTpl, function(items) {
			cb(m.getPodcastRssXml(info[channelId], items));
		});
	});
}

m.getPodcastRssXmlByChannelId = function(channelId, feedUrl, enclosureUrlTpl, cb) {
	m.getChannelInfoById(channelId, feedUrl, function(info) {
		// Get the channel id
		for (var channelId in info) { continue; }

		m.getPodcastItemsByChannelId(channelId, enclosureUrlTpl, function(items) {
			cb(m.getPodcastRssXml(info[channelId], items));
		});
	});
}

m.getAudioStreamByVideoId = function (videoId, outputStream) {
	const vidUrl = 'https://www.youtube.com/watch?v=' + videoId;
	const audioSavePath = __dirname + path.sep + config.get('local.audioSavePath') + path.sep + videoId + '.mp3';
	if (!fs.existsSync(audioSavePath)) {
		saveAudioFile(videoId);
		console.log(new Date() + " use online to stream: " + vidUrl);
		let videoStream = ytdl(vidUrl, {filter: 'audioonly', 'quality': 'lowest'});
		return ffmpeg().input(videoStream).audioBitRate('48').format('mp3').pipe();
	} else {
		console.log(new Date() + " use cache file to stream: " + vidUrl);
		return fs.createReadStream(audioSavePath);
	}
	// let videoStream = ytdl(vidUrl, {filter: 'audioonly'});
};

m.getAudioCacheFileSize = function (videoId) {
	const audioSavePath = __dirname + path.sep + config.get('local.audioSavePath') + path.sep + videoId + '.mp3';
	if (!fs.existsSync(audioSavePath)) {
		return 0;
	} else {
		return fs.statSync(audioSavePath).size;
	}
};

saveAudioFile = async function (videoId) {
	const audioSavePath = __dirname + path.sep + config.get('local.audioSavePath') + path.sep + videoId + '.mp3';
	const vidUrl = 'https://www.youtube.com/watch?v=' + videoId;
	// console.log("ytb url:" + vidUrl);
	// let videoStream = ytdl(vidUrl, {filter: 'audioonly'});
	if (!fs.existsSync(audioSavePath)) {
		console.log(new Date() + " start download job: " + vidUrl);
		let videoStream = ytdl(vidUrl, {filter: 'audioonly', 'quality': 'lowest'});
		ffmpeg().input(videoStream).audioBitRate('48').format('mp3')
			.on('error', function (err) {
				console.log(new Date() +" " +videoId + ' An error occurred: ' + err.message);
			})
			.save(audioSavePath);
	}
};

m.audioSavePathInit = function (dir) {
	const audioSavePath = __dirname + path.sep + dir;
	if (!fs.existsSync(audioSavePath)) {
		fs.mkdirSync(audioSavePath);
	}
	console.log("audio save path init success")
};