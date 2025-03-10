/*
*  Frappe Better Attach Control © 2023
*  Author:  Ameen Ahmed
*  Company: Level Up Marketing & Software Development Services
*  Licence: Please refer to LICENSE file
*/


import {
    isObject,
    isPlainObject,
    isEmpty,
    error
} from './../../utils';
import {
    get_filename,
    get_file_ext,
    get_file_type
} from './../../filetypes';


frappe.ui.FileUploader = class FileUploader extends frappe.ui.FileUploader {
    constructor(opts) {
        super(opts || {});
        if (!this.uploader) return;
        this._override_uploader(opts);
        var me = this;
        this.uploader.$watch('show_file_browser', function(show_file_browser) {
            if (show_file_browser && !me.uploader.$refs.file_browser._restrictions) {
                me._override_file_browser(
                    isPlainObject(opts) && !isEmpty(opts.restrictions)
                    ? opts.restrictions
                    : {
                        max_file_size: null,
                        max_number_of_files: null,
                        allowed_file_types: []
                    }
                );
            }
        });
    }
    _override_uploader(opts) {
        var up = this.uploader;
        if (isPlainObject(opts) && !isEmpty(opts.restrictions)) {
            up.restrictions.as_public = !!opts.restrictions.as_public;
        }
        up.dropfiles = function(e) {
			this.is_dragging = false;
			if (isObject(e) && isObject(e.dataTransfer))
			    this.add_files(e.dataTransfer.files);
		};
        up.show_max_files_number_warning = function(file, max_number_of_files) {
            console.warn(
                `File skipped because it exceeds the allowed specified limit of ${max_number_of_files} uploads`,
                file
            );
            if (this.doctype) {
                MSG = __('File "{0}" was skipped because only {1} uploads are allowed for DocType "{2}"',
                    [file.name, max_number_of_files, this.doctype]);
            } else {
                MSG = __('File "{0}" was skipped because only {1} uploads are allowed',
                    [file.name, max_number_of_files]);
            }
            frappe.show_alert({
                message: MSG,
                indicator: "orange",
            });
        };
        up.prepare_files = function(file_array) {
            let is_single = isPlainObject(file_array),
            files = is_single ? [file_array] : Array.from(file_array);
            files = files.map(function(f) {
                if (f.name == null) f.name = f.file_name || get_filename(f.file_url);
                if (f.type == null) f.type = get_file_type(get_file_ext(f.file_url)) || '';
                if (f.size == null) f.size = 0;
                return f;
            });
            files = files.filter(this.check_restrictions);
            if (isEmpty(files)) return !is_single ? [] : null;
            var me = this;
            files = files.map(function(file) {
                let is_image =  file.type.startsWith('image');
                return {
                    file_obj: file,
                    is_image,
                    name: file.name,
                    doc: null,
                    progress: 0,
                    total: 0,
                    failed: false,
                    uploading: false,
                    private: !me.restrictions.as_public || !is_image,
                };
            });
            return !is_single ? files : files[0];
        };
        up.add_files = function(file_array, custom) {
            var files = this.prepare_files(file_array),
            max_number_of_files = this.restrictions.max_number_of_files;
            if (max_number_of_files) {
                var uploaded = (this.files || []).length,
                total = uploaded + files.length;
                if (total > max_number_of_files) {
                    var slice_index = max_number_of_files - uploaded - 1,
                    me = this;
                    files.slice(slice_index).forEach(function(file) {
                        me.show_max_files_number_warning(file, max_number_of_files);
                    });
                    files = files.slice(0, max_number_of_files);
                }
            }
            this.files = this.files.concat(files);
        };
        up.upload_via_web_link = function() {
            let file_url = this.$refs.web_link.url;
            if (!file_url) {
                error('Invalid URL');
                return Promise.reject();
            }
            file_url = decodeURI(file_url);
            let file = this.prepare_files({file_url});
            return file ? this.upload_file(file) : Promise.reject();
        };
    }
    _override_file_browser(opts) {
        var fb = this.uploader.$refs.file_browser;
        fb._restrictions = opts;
        fb.check_restrictions = function(file) {
            if (file.is_folder) return true;
            let { max_file_size, allowed_file_types = [] } = this._restrictions,
            is_correct_type = true,
            valid_file_size = true;
            if (!isEmpty(allowed_file_types)) {
                is_correct_type = allowed_file_types.some(function(type) {
                    if (type.includes('/')) {
                        if (!file.type) return false;
                        return file.type.match(type);
                    }
                    if (type[0] === '.') {
                        return (file.name || file.file_name).endsWith(type);
                    }
                    return false;
                });
            }
            if (max_file_size && file.size != null && file.size) {
                valid_file_size = file.size < max_file_size;
            }
            return is_correct_type && valid_file_size;
        };
        fb.get_files_in_folder = function(folder, start) {
            var me = this;
            return frappe.call(
                'frappe_better_attach_control.api.get_files_in_folder',
                {
                    folder,
                    start,
                    page_length: this.page_length
                }
            ).then(function(r) {
                let { files = [], has_more = false } = r.message || {};
                if (!isEmpty(files)) {
                    files = files.map(function(f) {
                        if (f.name == null) f.name = f.file_name || get_filename(f.file_url);
                        if (f.type == null) f.type = get_file_type(get_file_ext(f.file_url)) || '';
                        if (f.size == null) f.size = 0;
                        return f;
                    });
                    files = files.filter(me.check_restrictions);
                    files.sort(function(a, b) {
                        if (a.is_folder && b.is_folder) {
                            return a.modified < b.modified ? -1 : 1;
                        }
                        if (a.is_folder) return -1;
                        if (b.is_folder) return 1;
                        return 0;
                    });
                    files = files.map(function(file) {
                        return me.make_file_node(file);
                    });
                }
                return { files, has_more };
            });
        };
        fb.search_by_name = frappe.utils.debounce(function() {
            if (this.search_text === '') {
                this.node = this.folder_node;
                return;
            }
            if (this.search_text.length < 3) return;
            var me = this;
            frappe.call(
                'frappe_better_attach_control.api.get_files_by_search_text',
                {text: this.search_text}
            ).then(function(r) {
                let files = r.message || [];
                if (!isEmpty(files)) {
                    files = files.map(function(f) {
                        if (f.name == null) f.name = f.file_name || get_filename(f.file_url);
                        if (f.type == null) f.type = get_file_type(get_file_ext(f.file_url)) || '';
                        if (f.size == null) f.size = 0;
                        return f;
                    });
                    files = files.filter(me.check_restrictions)
                        .map(function(file) {
                            return me.make_file_node(file);
                        });
                }
                if (!me.folder_node) me.folder_node = me.node;
                me.node = {
                    label: __('Search Results'),
                    value: '',
                    children: files,
                    by_search: true,
                    open: true,
                    filtered: true
                };
            });
        }, 300);
    }
};