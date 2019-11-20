const fs = require("fs")
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const Queue = require('bull');
const audioQueue = new Queue('audio transcoding', {
    redis: {port: 6379, host: '127.0.0.1'},
    limiter: {
        max: 10,
        duration: 60000 // per duration milliseconds
    }
}); // Specify Redis connection using object


const {exec} = require('child_process');


const config = require('nodejs-config')(
    __dirname
);
const m = module.exports = {};
audioQueue.process("audio_download",1,function (job, done) {
    saveAudioFile(job.data.videoId)
});
m.getPodcastItemsByChannelId = function (channelId, enclosureUrlTpl, cb) {
    const {google} = require('googleapis');

    const _ = require('underscore');
    const yt = google.youtube('v3');

    yt.search.list({
        part: 'id,snippet',
        channelId: channelId,
        key: config.get('local.youtubeApiKey'),
        maxResults: 50,
        order: 'date', // descending date order is important for a podcast
        type: 'video',
    }, function (err, list) {
        // Pull out the relevant items for our podcast RSS
        let items = list.data.items;

        // Map into our desired format

        items = _.map(_.filter(items, function (item) {
            if (item.snippet.liveBroadcastContent !== 'live') {
                return items
            }
        }), function (item) {
            // sync to save audio
            // use queue
            audioQueue.add("audio_download",{"videoId":item.id.videoId},{
                "jobId":item.id.videoId
            });
            // saveAudioFile(item.id.videoId);

            return {
                title: item.snippet.title,
                description: item.snippet.description,
                url: 'http://youtu.be/' + item.id.videoId,
                date: item.snippet.publishedAt,
                enclosure: {
                    url: enclosureUrlTpl.replace('[videoId]', item.id.videoId),
                    type: 'audio/mpeg',
                }
            };
        });


        cb(items);
    });
};

m.getChannelInfoById = function (channelId, feedUrl, cb) {
    const {google} = require('googleapis');
    const yt = google.youtube('v3');

    return yt.channels.list({
        part: 'id,snippet',
        id: channelId,
        key: config.get('local.youtubeApiKey')
    }, function (err, list) {
        const channel = list.data.items[0];
        const ret = {};

        if (!channel) return;

        ret[channel.id] = {
            title: channel.snippet.title,
            description: channel.snippet.description,
            feed_url: feedUrl,
            site_url: "http://youtube.com/channel/" + channel.id,
            image_url: channel.snippet.thumbnails.default.url,
        };
        cb(ret);
    });
};

m.getChannelInfoByUsername = function (username, feedUrl, cb) {
    const {google} = require('googleapis');
    const yt = google.youtube('v3');

    return yt.channels.list({
        part: 'id,snippet',
        forUsername: username,
        key: config.get('local.youtubeApiKey')
    }, function (err, list) {
        var channel = list.data.items[0];
        var ret = {};

        if (!channel) return;

        ret[channel.id] = {
            title: channel.snippet.title,
            description: channel.snippet.description,
            feed_url: feedUrl,
            site_url: "http://youtube.com/channel/" + channel.id,
            image_url: channel.snippet.thumbnails.default.url,
        };
        cb(ret);
    });
};

m.getPodcastRssXml = function (info, items) {
    const rss = require('rss');
    const _ = require('underscore');

    const feed = new rss(info);
    _.each(items, function (item) {
        feed.item(item);
    });

    return feed.xml();
};

m.getPodcastRssXmlByUsername = function (username, feedUrl, enclosureUrlTpl, cb) {
    m.getChannelInfoByUsername(username, feedUrl, function (info) {
        // Get the channel id
        for (var channelId in info) {
            continue;
        }

        m.getPodcastItemsByChannelId(channelId, enclosureUrlTpl, function (items) {
            cb(m.getPodcastRssXml(info[channelId], items));
        });
    });
};

m.getPodcastRssXmlByChannelId = function (channelId, feedUrl, enclosureUrlTpl, cb) {
    m.getChannelInfoById(channelId, feedUrl, function (info) {
        // Get the channel id
        for (var channelId in info) {
            continue;
        }

        m.getPodcastItemsByChannelId(channelId, enclosureUrlTpl, function (items) {
            cb(m.getPodcastRssXml(info[channelId], items));
        });
    });
};

m.getAudioStreamByVideoId = function (videoId, cb) {
    const vidUrl = 'https://www.youtube.com/watch?v=' + videoId;
    const audioSavePath = __dirname + path.sep + config.get('local.audioSavePath') + path.sep + videoId + '.mp3';
    let job=audioQueue.getJobFromId(videoId);
    if (job.isCompleted()) {
        console.log(new Date().toLocaleString() + " use cache file to stream: " + vidUrl);
        cb(fs.createReadStream(audioSavePath), fs.statSync(audioSavePath).size);
    }else{
        job.on('completed', function(job, result){
            cb(fs.createReadStream(audioSavePath), fs.statSync(audioSavePath).size);
        });
    }

    // if (!fs.existsSync(audioSavePath)) {
    //     saveAudioFile(videoId, cb);
    //     // console.log(new Date().toLocaleString() + " use online to stream: " + vidUrl);
    //     // let videoStream = ytdl(vidUrl);
    //     // ffmpeg().input(videoStream).withAudioBitrate('48').format('mp3').pipe();
    // } else {
    //     console.log(new Date().toLocaleString() + " use cache file to stream: " + vidUrl);
    //     cb(fs.createReadStream(audioSavePath), fs.statSync(audioSavePath).size)
    // }
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

saveAudioFile = async function (videoId, cb) {
    const audioSavePath = __dirname + path.sep + config.get('local.audioSavePath') + path.sep + videoId + '.mp3';
    const vidUrl = 'https://www.youtube.com/watch?v=' + videoId;
    // console.log("ytb url:" + vidUrl);
    // let videoStream = ytdl(vidUrl, {filter: 'audioonly'});
    if (!fs.existsSync(audioSavePath)) {
        console.log(new Date().toLocaleString() + " start download job: " + vidUrl);
        // let videoStream = ytdl(vidUrl);
        //use system cmd
        // console.log(stdout);
        // ffmpeg().input(videoStream).withAudioBitrate('48').format('mp3')
        //     .on('error', function (err) {
        //         console.log(new Date().toLocaleString() + " " + videoId + ' An error occurred: ' + err.message);
        //     }).on('end', function () {
        //     if (cb && typeof cb === "function") {
        //         cb(fs.createReadStream(audioSavePath), fs.statSync(audioSavePath).size)
        //     }
        // }).save(audioSavePath);

        exec("youtube-dl -f 'worstaudio' '" + vidUrl + "' -o " + audioSavePath, function (err, stdout, stderr) {
            if (err || stderr) {
                console.error(new Date().toLocaleString() + "\t" + err);
                console.error("\t\t" + stderr);
                cb(null, null, stderr)
            } else {
                if (cb && typeof cb === "function") {
                    cb(fs.createReadStream(audioSavePath), fs.statSync(audioSavePath).size, err);
                }
            }
        });


    }
};

m.audioSavePathInit = function (dir) {
    const audioSavePath = __dirname + path.sep + dir;
    if (!fs.existsSync(audioSavePath)) {
        fs.mkdirSync(audioSavePath);
    }
    console.log("audio save path init success")
};